/**
 * Module dùng chung để hiển thị 1 layer vector tĩnh (polygon/line/point) trên bản đồ CesiumJS.
 * Dữ liệu GeoJSON (convert từ shapefile bằng ogr2ogr), phủ toàn khu vực, không thuộc dự án nào.
 * Thay vì viết riêng 1 class cho mỗi layer (như ParcelTool.js/RoadTool.js), 1 instance của class
 * này phục vụ 1 layer, cấu hình khác nhau qua tham số `config` truyền vào constructor.
 *
 * @typedef {object} VectorLayerConfig
 * @property {string} id Định danh duy nhất của layer (dùng làm id DOM cho popup, không được trùng)
 * @property {boolean} hasPopup Có hiện popup khi click vào đối tượng không (false cho layer chỉ vẽ viền)
 * @property {string} [popupTitle] Tiêu đề popup (bắt buộc nếu hasPopup = true)
 * @property {{field: string, label: string, format?: (v:any)=>string}[]} [popupFields] Danh sách
 *   trường hiển thị trong popup, theo đúng thứ tự
 * @property {object} loadOptions Options truyền thẳng vào Cesium.GeoJsonDataSource.load()
 */
class VectorLayerTool {
  constructor(viewer, config) {
    this.viewer = viewer;
    this.config = config;
    this.dataSource = null;
    this.selectedEntity = null;
    this.userVisible = true; // Mặc định bật hiển thị từ UI
    this.listenersSetup = false;

    if (config.hasPopup) {
      this.initPopupDOM();
    }
  }

  /**
   * Tải và nạp dữ liệu vector từ file GeoJSON
   * @param {string} geojsonUrl Đường dẫn file GeoJSON
   */
  async load(geojsonUrl) {
    try {
      this.dataSource = await Cesium.GeoJsonDataSource.load(geojsonUrl, this.config.loadOptions);
      await this.viewer.dataSources.add(this.dataSource);
      this.dataSource.show = this.userVisible;

      console.log(`[${this.config.id}] Đã nạp ${this.dataSource.entities.values.length} đối tượng.`);

      if (this.config.hasPopup && !this.listenersSetup) {
        this.setupListeners();
        this.listenersSetup = true;
      }
    } catch (err) {
      console.error(`[${this.config.id}] Lỗi khi nạp dữ liệu:`, err);
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
      const pickedObject = this.viewer.scene.pick(click.position);

      if (
        Cesium.defined(pickedObject) &&
        pickedObject.id &&
        this.dataSource.entities.contains(pickedObject.id)
      ) {
        this.selectEntity(pickedObject.id);
      } else if (this.selectedEntity) {
        this.hidePopup();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    this.viewer.scene.postRender.addEventListener(() => {
      this.updatePopupPosition();
    });
  }

  /**
   * Phương thức điều khiển bật/tắt toàn bộ layer từ UI
   * @param {boolean} visible Trạng thái hiển thị
   */
  setVisible(visible) {
    this.userVisible = visible;
    if (this.dataSource) {
      this.dataSource.show = visible;
    }
    if (!visible) {
      this.hidePopup();
    }
  }

  /**
   * Chọn một đối tượng và hiển thị popup thông tin
   */
  selectEntity(entity) {
    this.selectedEntity = entity;
    const popupId = `vectorPopup_${this.config.id}`;
    const props = entity.properties;

    for (const f of this.config.popupFields) {
      const raw = props?.[f.field]?.getValue();
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
    this.selectedEntity = null;
    if (this.popupElement) {
      this.popupElement.style.display = "none";
    }
  }

  /**
   * Tính điểm neo popup theo đúng loại hình học của entity:
   * - Point: dùng thẳng entity.position
   * - Polygon: trung bình cộng Cartesian3 các đỉnh vòng ngoài (entity.polygon.hierarchy)
   * - Line: trung bình cộng Cartesian3 các đỉnh (entity.polyline.positions)
   */
  getEntityAnchorPosition(entity, time) {
    if (entity.position) {
      return entity.position.getValue(time);
    }

    const positions =
      entity.polygon?.hierarchy?.getValue(time)?.positions ??
      entity.polyline?.positions?.getValue(time);
    if (!positions || positions.length === 0) return undefined;

    let x = 0,
      y = 0,
      z = 0;
    for (const pos of positions) {
      x += pos.x;
      y += pos.y;
      z += pos.z;
    }
    const n = positions.length;
    return new Cesium.Cartesian3(x / n, y / n, z / n);
  }

  /**
   * Cập nhật tọa độ màn hình (2D Pixel) của popup dựa vào điểm neo của entity đang chọn
   */
  updatePopupPosition() {
    if (!this.selectedEntity || this.popupElement.style.display === "none") return;

    const anchor = this.getEntityAnchorPosition(this.selectedEntity, this.viewer.clock.currentTime);
    if (!anchor) {
      this.hidePopup();
      return;
    }

    const canvasPosition = this.viewer.scene.cartesianToCanvasCoordinates(anchor, new Cesium.Cartesian2());
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
