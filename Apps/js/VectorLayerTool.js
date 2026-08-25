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
    this.highlightEntities = []; // Entity viền nổi bật đang vẽ cho đối tượng vừa click
    this.baseAlpha = 1; // Độ đậm do người dùng chọn bằng thanh kéo (1 = đậm nhất)
    this.dimmed = false; // Đang tạm mờ vì có đối tượng được chọn hay không

    if (config.hasPopup) {
      this.initPopupDOM();
      VectorLayerTool.instances.push(this);
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
    this.applyAlpha();

    if (this.config.hasPopup) {
      VectorLayerTool.setupGlobalListener(this.viewer);
      if (!this.listenersSetup) {
        // Popup neo theo toạ độ thế giới nên phải tính lại vị trí mỗi khung hình
        this.viewer.scene.postRender.addEventListener(() => {
          this.updatePopupPosition();
        });
        this.listenersSetup = true;
      }
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
   * Đăng ký DUY NHẤT 1 bộ bắt sự kiện click cho toàn bộ layer (gọi bao nhiêu lần cũng chỉ tạo
   * 1 lần). Trước đây mỗi layer tự bắt click riêng, nên 1 cú click làm cả 6 layer cùng vẽ viền
   * đỏ + mở popup đè lên nhau — người dùng thấy 2-3 viền đỏ và tưởng viền vẽ sai đối tượng.
   * Giờ 1 click chỉ chọn ra ĐÚNG 1 đối tượng theo thứ tự ưu tiên trong HIT_PRIORITY.
   */
  static setupGlobalListener(viewer) {
    if (VectorLayerTool.globalListenerSetup) return;
    VectorLayerTool.globalListenerSetup = true;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
      if (!cartesian) {
        VectorLayerTool.clearAll();
        return;
      }
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      VectorLayerTool.handleClick(lon, lat, cartesian);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  /**
   * Dọn sạch viền nổi bật + popup của TẤT CẢ layer, không riêng layer nào.
   */
  static clearAll() {
    for (const layer of VectorLayerTool.instances) {
      layer.hidePopup();
    }
  }

  /**
   * Hỏi song song mọi layer đang bật xem điểm click rơi vào đối tượng nào, rồi chỉ hiện đúng
   * 1 kết quả theo thứ tự ưu tiên: đối tượng càng nhỏ/càng cụ thể càng được ưu tiên (lô thửa
   * hơn đường, đường hơn vùng quy hoạch phủ rộng).
   */
  static async handleClick(lon, lat, cartesian) {
    const active = VectorLayerTool.instances.filter((layer) => layer.imageryLayer?.show);
    const results = await Promise.all(active.map((layer) => layer.fetchFeature(lon, lat)));

    let best = null;
    let bestRank = Infinity;
    active.forEach((layer, i) => {
      if (!results[i]) return;
      let rank = VectorLayerTool.HIT_PRIORITY.indexOf(layer.config.id);
      if (rank === -1) rank = VectorLayerTool.HIT_PRIORITY.length;
      if (rank < bestRank) {
        bestRank = rank;
        best = { layer, data: results[i] };
      }
    });

    VectorLayerTool.clearAll();
    if (!best) return;

    best.layer.selectedPosition = cartesian;
    best.layer.showHighlight(best.data.__geometry);
    best.layer.showPopup(best.data);
  }

  /**
   * Hỏi API /api/vector-hit xem điểm vừa click có rơi vào feature nào của layer này không —
   * dữ liệu thật (PostGIS) chỉ được truy vấn lúc này, không tải sẵn trong trình duyệt.
   * Chỉ TRẢ VỀ dữ liệu, việc quyết định hiện layer nào do handleClick lo.
   * @returns {Promise<object|null>} Thuộc tính + __geometry của feature trúng, null nếu trượt
   */
  async fetchFeature(lon, lat) {
    try {
      const response = await fetch(`/api/vector-hit?layer=${this.config.id}&lon=${lon}&lat=${lat}`);
      if (!response.ok) return null;
      const data = await response.json();
      if (!data || Object.keys(data).length === 0) return null;
      return data;
    } catch (err) {
      console.error(`[${this.config.id}] Lỗi khi tra cứu feature:`, err);
      return null;
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
   * Đặt độ đậm của layer theo thanh kéo trên menu (liên tục, không theo nấc).
   * @param {number} alpha 0 = trong suốt hoàn toàn, 1 = đậm nhất
   */
  setOpacity(alpha) {
    this.baseAlpha = alpha;
    this.applyAlpha();
  }

  /**
   * Tạm làm mờ layer khi đang có đối tượng được chọn, để nhìn xuyên xuống ảnh nền bên dưới
   * (nền vàng lô thửa che kín bản đồ, chọn 1 thửa mà không thấy hiện trạng dưới đó thì vô nghĩa).
   * Chỉ giảm còn DIM_FACTOR lần độ đậm hiện tại — vẫn thấy màu layer, không biến mất hẳn.
   * @param {boolean} dimmed
   */
  setDimmed(dimmed) {
    this.dimmed = dimmed;
    this.applyAlpha();
  }

  /**
   * Áp độ đậm cuối cùng lên layer ảnh = độ đậm người dùng chọn, nhân thêm hệ số mờ nếu đang
   * có đối tượng được chọn. Gom vào 1 chỗ để thanh kéo và việc chọn đối tượng không đè lên nhau.
   */
  applyAlpha() {
    if (!this.imageryLayer) return;
    this.imageryLayer.alpha = this.dimmed ? this.baseAlpha * VectorLayerTool.DIM_FACTOR : this.baseAlpha;
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
    this.clearHighlight();
    if (this.popupElement) {
      this.popupElement.style.display = "none";
    }
  }

  /**
   * Xoá viền nổi bật (nếu có) của lần click trước đó.
   */
  clearHighlight() {
    for (const entity of this.highlightEntities) {
      this.viewer.entities.remove(entity);
    }
    this.highlightEntities = [];
    this.setDimmed(false); // Hết chọn thì trả layer về đúng độ đậm của thanh kéo
  }

  /**
   * Vẽ viền nổi bật đúng hình dạng thật của đối tượng vừa click (Polygon/Line/Point) —
   * đè lên trên ảnh raster để người dùng thấy rõ đang xem đúng đối tượng nào, không chỉ có popup
   * chữ. Dùng Cesium.Entity (không phải raster), nhưng chỉ 1 đối tượng/lần click nên không lag.
   * @param {object} geometry GeoJSON geometry lấy từ ST_AsGeoJSON (toạ độ [lon, lat])
   */
  showHighlight(geometry) {
    this.clearHighlight();
    if (!geometry) return;
    this.setDimmed(true);

    const color = Cesium.Color.fromCssColorString("#ff2d2d");

    // Chỉ vẽ ĐƯỜNG VIỀN (polyline riêng, không dùng polygon.material) — không tô/đổi màu vùng
    // bên trong, giữ nguyên màu ACI gốc, chỉ làm nổi bật khung của đối tượng vừa click.
    const addPolygonRing = (ring) => {
      this.highlightEntities.push(
        this.viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
            width: 5,
            material: color,
            clampToGround: false,
          },
        }),
      );
    };
    const addLine = (line) => {
      this.highlightEntities.push(
        this.viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(line.flat()),
            width: 5,
            material: color,
          },
        }),
      );
    };
    const addPoint = (pt) => {
      this.highlightEntities.push(
        this.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(pt[0], pt[1]),
          point: { pixelSize: 16, color: Cesium.Color.TRANSPARENT, outlineColor: color, outlineWidth: 4 },
        }),
      );
    };

    switch (geometry.type) {
      case "Polygon":
        addPolygonRing(geometry.coordinates[0]);
        break;
      case "MultiPolygon":
        geometry.coordinates.forEach((poly) => addPolygonRing(poly[0]));
        break;
      case "LineString":
        addLine(geometry.coordinates);
        break;
      case "MultiLineString":
        geometry.coordinates.forEach(addLine);
        break;
      case "Point":
        addPoint(geometry.coordinates);
        break;
      case "MultiPoint":
        geometry.coordinates.forEach(addPoint);
        break;
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

// Mọi layer có popup, dùng chung 1 bộ bắt click (xem setupGlobalListener).
VectorLayerTool.instances = [];
VectorLayerTool.globalListenerSetup = false;

// Thứ tự ưu tiên khi 1 điểm click trúng nhiều layer cùng lúc — đối tượng cụ thể/nhỏ đứng
// trước, vùng phủ rộng đứng sau. Vùng quy hoạch bao trùm cả chục lô thửa nên luôn xếp cuối,
// nếu không nó sẽ "ăn" hết mọi cú click vào lô thửa. Layer không có tên ở đây tự động xếp cuối.
VectorLayerTool.HIT_PRIORITY = ["loThua", "tenDuong", "timDuong", "tuyenDuong", "longDuong", "qhCnsdd"];

// Hệ số làm mờ layer đang có đối tượng được chọn — 0.5 = còn nửa độ đậm: vẫn thấy rõ màu
// của layer nhưng nhìn xuyên được xuống ảnh nền. Chỉnh số này để mờ nhiều/ít hơn.
VectorLayerTool.DIM_FACTOR = 0.5;

// Gán toàn cục để sử dụng trong app.js
window.VectorLayerTool = VectorLayerTool;
