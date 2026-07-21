/**
 * Module dùng chung để hiển thị 1 layer vector tĩnh (polygon/line/point) trên bản đồ CesiumJS.
 *
 * Kiến trúc: dữ liệu vector đã được "vẽ sẵn" thành ảnh raster (tô đúng màu ACI gốc từ CAD,
 * xem scripts/rasterize-layer.sh) và cắt tile giống hệt ảnh flycam, nạp vào cùng bảng "tiles"
 * với project_key riêng (`vector_<id>`). Bản đồ chỉ hiển thị ẢNH TĨNH — không tạo Entity Cesium
 * nào, nên không lag dù dữ liệu gốc có hàng nghìn feature. Khi người dùng click vào bản đồ mới
 * hỏi API `/api/vector-hit` (PostGIS) tìm đúng feature tại điểm đó để hiện popup — dữ liệu thật
 * chỉ được truy vấn theo yêu cầu, không nằm sẵn trong bộ nhớ trình duyệt.
 *
 * Thay vì viết riêng 1 class cho mỗi layer, 1 instance của class này phục vụ 1 layer, cấu hình
 * khác nhau qua tham số `config` truyền vào constructor.
 *
 * @typedef {object} VectorLayerConfig
 * @property {string} id Định danh layer (khớp key trong VECTOR_TABLES của server.js và
 *   project_key `vector_<id lowercase>` trong bảng tiles — xem scripts/rasterize-layer.sh)
 * @property {boolean} hasPopup Có hiện popup khi click vào đối tượng không (false cho layer chỉ vẽ viền)
 * @property {string} [popupTitle] Tiêu đề popup (bắt buộc nếu hasPopup = true)
 * @property {{field: string, label: string, format?: (v:any)=>string}[]} [popupFields] Danh sách
 *   trường hiển thị trong popup — `field` phải khớp đúng tên cột Postgres (viết thường, xem
 *   `\d vec_<table>` để xác nhận, ogr2ogr tự hạ chữ thường tên field khi tạo bảng)
 */
class VectorLayerTool {
  constructor(viewer, config) {
    this.viewer = viewer;
    this.config = config;
    this.imageryLayer = null;
    this.selectedPosition = null; // Cartesian3 của điểm vừa click, dùng neo popup theo camera
    this.userVisible = true; // Mặc định bật hiển thị từ UI
    this.listenersSetup = false;

    if (config.hasPopup) {
      this.initPopupDOM();
    }
  }

  /**
   * Gắn layer ảnh raster (đã cắt tile z/x/y, nạp sẵn trong bảng "tiles") lên bản đồ.
   * project_key suy ra từ config.id, khớp quy ước đặt tên của scripts/rasterize-layer.sh.
   */
  load() {
    const projectKey = `vector_${this.config.id.toLowerCase()}`;
    // Bbox phủ toàn khu vực Tân Bình — tile ngoài phạm vi dữ liệu thật đơn giản không tồn tại
    // (route /tiles trả 404, Cesium tự hiểu là ô trong suốt, không lỗi gì).
    const rectangle = Cesium.Rectangle.fromDegrees(106.567348, 10.754722, 106.603895, 10.827578);

    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `/tiles/${projectKey}/{z}/{x}/{y}.png`,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      rectangle,
      minimumLevel: 15,
      maximumLevel: 18,
    });

    this.imageryLayer = this.viewer.imageryLayers.addImageryProvider(provider);
    this.imageryLayer.show = this.userVisible;

    if (this.config.hasPopup && !this.listenersSetup) {
      this.setupListeners();
      this.listenersSetup = true;
    }
  }

  /**
   * Tạo cấu trúc HTML cho popup hiển thị thông tin đối tượng
   */
  initPopupDOM() {
    const popupId = `vectorPopup_${this.config.id}`;
    if (document.getElementById(popupId)) return;

    const rows = this.config.popupFields
      .map(
        (f) => `
          <div class="popup-row">
            <span class="popup-label">${f.label}:</span>
            <span class="popup-value" id="${popupId}_${f.field}">-</span>
          </div>`,
      )
      .join("");

    const popupHtml = `
      <div id="${popupId}" class="elevation-popup vector-popup">
        <div class="popup-close" id="${popupId}_close">&times;</div>
        <div class="popup-title">${this.config.popupTitle}</div>
        <div class="popup-body">${rows}</div>
      </div>
    `;

    const div = document.createElement("div");
    div.innerHTML = popupHtml.trim();
    document.body.appendChild(div.firstChild);

    document.getElementById(`${popupId}_close`).addEventListener("click", () => {
      this.hidePopup();
    });

    this.popupElement = document.getElementById(popupId);
  }

  /**
   * Thiết lập các bộ lắng nghe sự kiện
   */
  setupListeners() {
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction((click) => {
      if (!this.imageryLayer.show) return;

      const cartesian = this.viewer.camera.pickEllipsoid(click.position, this.viewer.scene.globe.ellipsoid);
      if (!cartesian) {
        this.hidePopup();
        return;
      }
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      this.queryFeature(lon, lat, cartesian);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    this.viewer.scene.postRender.addEventListener(() => {
      this.updatePopupPosition();
    });
  }

  /**
   * Hỏi API /api/vector-hit xem điểm vừa click có rơi vào feature nào của layer này không —
   * dữ liệu thật (PostGIS) chỉ được truy vấn lúc này, không tải sẵn trong trình duyệt.
   */
  async queryFeature(lon, lat, cartesian) {
    try {
      const response = await fetch(`/api/vector-hit?layer=${this.config.id}&lon=${lon}&lat=${lat}`);
      const data = await response.json();
      if (!data || Object.keys(data).length === 0) {
        this.hidePopup();
        return;
      }
      this.selectedPosition = cartesian;
      this.showPopup(data);
    } catch (err) {
      console.error(`[${this.config.id}] Lỗi khi tra cứu feature:`, err);
      this.hidePopup();
    }
  }

  /**
   * Phương thức điều khiển bật/tắt toàn bộ layer từ UI
   * @param {boolean} visible Trạng thái hiển thị
   */
  setVisible(visible) {
    this.userVisible = visible;
    if (this.imageryLayer) {
      this.imageryLayer.show = visible;
    }
    if (!visible) {
      this.hidePopup();
    }
  }

  /**
   * Hiện popup với dữ liệu thuộc tính trả về từ API (JSON phẳng, field đã đúng tên cột Postgres)
   */
  showPopup(data) {
    const popupId = `vectorPopup_${this.config.id}`;
    for (const f of this.config.popupFields) {
      const raw = data[f.field];
      const el = document.getElementById(`${popupId}_${f.field}`);
      if (el) el.innerText = f.format ? f.format(raw) : (raw ?? "-");
    }

    this.popupElement.style.display = "block";
    this.updatePopupPosition();
  }

  /**
   * Ẩn bảng popup nổi
   */
  hidePopup() {
    this.selectedPosition = null;
    if (this.popupElement) {
      this.popupElement.style.display = "none";
    }
  }

  /**
   * Cập nhật tọa độ màn hình (2D Pixel) của popup dựa vào điểm Cartesian3 đã click —
   * không có Entity nào để bám theo (layer chỉ là ảnh raster), nên lưu thẳng toạ độ thế giới
   * của điểm click và tự tính lại vị trí màn hình mỗi khi camera di chuyển.
   */
  updatePopupPosition() {
    if (!this.selectedPosition || this.popupElement.style.display === "none") return;

    const canvasPosition = this.viewer.scene.cartesianToCanvasCoordinates(
      this.selectedPosition,
      new Cesium.Cartesian2(),
    );
    if (Cesium.defined(canvasPosition)) {
      this.popupElement.style.left = `${canvasPosition.x - this.popupElement.offsetWidth / 2}px`;
      this.popupElement.style.top = `${canvasPosition.y - this.popupElement.offsetHeight - 20}px`;
    } else {
      this.popupElement.style.display = "none";
    }
  }
}

// Gán toàn cục để sử dụng trong app.js
window.VectorLayerTool = VectorLayerTool;
