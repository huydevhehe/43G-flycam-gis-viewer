/**
 * Module quản lý hiển thị lớp ranh giới thửa đất (địa chính) trên bản đồ CesiumJS.
 * Dữ liệu tĩnh dạng GeoJSON (convert từ shapefile bằng ogr2ogr), phủ toàn khu vực,
 * không thuộc dự án flycam nào cụ thể. Hiển thị popup thông tin khi click vào 1 thửa.
 */
class ParcelTool {
  constructor(viewer) {
    this.viewer = viewer;
    this.dataSource = null;
    this.selectedEntity = null;
    this.userVisible = true; // Mặc định bật hiển thị từ UI
    this.listenersSetup = false;

    // Bbox toàn bộ shapefile ThuaDat.shp (đọc trực tiếp từ header .shp) — khu vực Hà Nội,
    // dùng để đưa camera bay tới xem layer này (nó không nằm cùng vị trí các dự án flycam).
    this.bbox = Cesium.Rectangle.fromDegrees(105.801315, 21.016571, 105.830011, 21.036977);

    // Khởi tạo các phần tử DOM của popup
    this.initPopupDOM();
  }

  /**
   * Tải và nạp dữ liệu ranh giới thửa đất từ file GeoJSON
   * @param {string} geojsonUrl Đường dẫn file GeoJSON chứa các polygon thửa đất
   */
  async load(geojsonUrl) {
    try {
      this.dataSource = await Cesium.GeoJsonDataSource.load(geojsonUrl, {
        stroke: Cesium.Color.fromCssColorString("#FFD400"),
        strokeWidth: 2,
        fill: Cesium.Color.fromCssColorString("#FFD400").withAlpha(0.08),
        clampToGround: true, // Bám theo ảnh flycam/địa hình bên dưới, không lơ lửng
      });
      await this.viewer.dataSources.add(this.dataSource);
      this.dataSource.show = this.userVisible;

      console.log(`Đã nạp ${this.dataSource.entities.values.length} thửa đất.`);

      // Thiết lập lắng nghe click/render (chỉ làm 1 lần duy nhất)
      if (!this.listenersSetup) {
        this.setupListeners();
        this.listenersSetup = true;
      }
    } catch (err) {
      console.error("Lỗi khi nạp dữ liệu ranh giới thửa đất:", err);
    }
  }

  /**
   * Tạo cấu trúc HTML cho popup hiển thị thông tin thửa đất
   */
  initPopupDOM() {
    if (document.getElementById("parcelPopup")) return;

    const popupHtml = `
      <div id="parcelPopup" class="elevation-popup parcel-popup">
        <div class="popup-close" id="parcelPopupCloseBtn">&times;</div>
        <div class="popup-title">Thông tin thửa đất</div>
        <div class="popup-body">
          <div class="popup-row">
            <span class="popup-label">Tờ số - Thửa số:</span>
            <span class="popup-value" id="popupParcelSoTo">-</span>
          </div>
          <div class="popup-row">
            <span class="popup-label">Diện tích:</span>
            <span class="popup-value" id="popupParcelDienTich">-</span>
          </div>
          <div class="popup-row">
            <span class="popup-label">Loại đất:</span>
            <span class="popup-value" id="popupParcelLoaiDat">-</span>
          </div>
        </div>
      </div>
    `;

    const div = document.createElement("div");
    div.innerHTML = popupHtml.trim();
    document.body.appendChild(div.firstChild);

    // Lắng nghe sự kiện đóng popup
    document.getElementById("parcelPopupCloseBtn").addEventListener("click", () => {
      this.hidePopup();
    });

    this.popupElement = document.getElementById("parcelPopup");
  }

  /**
   * Thiết lập các bộ lắng nghe sự kiện
   */
  setupListeners() {
    // Lắng nghe sự kiện click chuột trái trên bản đồ để chọn 1 thửa đất
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction((click) => {
      const pickedObject = this.viewer.scene.pick(click.position);

      if (
        Cesium.defined(pickedObject) &&
        pickedObject.id &&
        pickedObject.id.properties &&
        Cesium.defined(pickedObject.id.properties.soHieuToBa) &&
        this.dataSource.entities.contains(pickedObject.id)
      ) {
        this.selectParcel(pickedObject.id);
      } else if (this.selectedEntity) {
        this.hidePopup();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Lắng nghe sự kiện render khung hình để cập nhật vị trí popup bám theo thửa đất
    this.viewer.scene.postRender.addEventListener(() => {
      this.updatePopupPosition();
    });
  }

  /**
   * Phương thức điều khiển bật/tắt toàn bộ lớp ranh giới thửa đất từ UI
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
   * Chọn một thửa đất và hiển thị popup thông tin
   */
  selectParcel(entity) {
    this.selectedEntity = entity;
    const props = entity.properties;

    const soHieu = props.soHieuToBa?.getValue();
    const soThu = props.soThuTuThu?.getValue();
    document.getElementById("popupParcelSoTo").innerText =
      soHieu != null && soThu != null ? `${soHieu} - ${soThu}` : "-";

    const dienTich = props.dienTich?.getValue();
    document.getElementById("popupParcelDienTich").innerText =
      dienTich != null ? `${dienTich.toFixed(1)} m²` : "-";

    document.getElementById("popupParcelLoaiDat").innerText = props.loaiDat?.getValue() ?? "-";

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
   * Tính tâm hình học xấp xỉ (trung bình cộng Cartesian3 các đỉnh vòng ngoài) của polygon
   * để dùng làm điểm neo popup — polygon không có sẵn thuộc tính position đơn như point.
   */
  getEntityCentroid(entity, time) {
    if (!entity.polygon || !entity.polygon.hierarchy) return undefined;
    const hierarchy = entity.polygon.hierarchy.getValue(time);
    const positions = hierarchy && hierarchy.positions;
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
   * Cập nhật tọa độ màn hình (2D Pixel) của popup dựa vào tâm hình học của thửa đất đang chọn
   */
  updatePopupPosition() {
    if (!this.selectedEntity || this.popupElement.style.display === "none") return;

    const centroid = this.getEntityCentroid(this.selectedEntity, this.viewer.clock.currentTime);
    if (!centroid) {
      this.hidePopup();
      return;
    }

    const canvasPosition = this.viewer.scene.cartesianToCanvasCoordinates(centroid, new Cesium.Cartesian2());
    if (Cesium.defined(canvasPosition)) {
      this.popupElement.style.left = `${canvasPosition.x - this.popupElement.offsetWidth / 2}px`;
      this.popupElement.style.top = `${canvasPosition.y - this.popupElement.offsetHeight - 20}px`;
    } else {
      this.popupElement.style.display = "none";
    }
  }
}

// Gán toàn cục để sử dụng trong app.js
window.ParcelTool = ParcelTool;
