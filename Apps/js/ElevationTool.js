/**
 * Module quản lý hiển thị các điểm đo độ cao thực tế trích xuất từ DEM trên bản đồ CesiumJS cho nhiều dự án.
 * Tự động hiển thị/ẩn theo mức zoom và hiển thị popup bám theo marker khi click.
 */
class ElevationTool {
  constructor(viewer) {
    this.viewer = viewer;
    this.projects = {}; // Quản lý dữ liệu riêng biệt của từng dự án
    this.selectedEntity = null;
    this.zoomThreshold = 1000; // Ngưỡng hiển thị khi camera dưới 1000m
    this.listenersSetup = false;

    // Khởi tạo các phần tử DOM của popup
    this.initPopupDOM();
  }

  /**
   * Tải và nạp dữ liệu độ cao cho một dự án cụ thể
   * @param {string} projKey Mã định danh dự án
   * @param {string} jsonUrl Đường dẫn file JSON chứa các điểm cao độ
   */
  async addProject(projKey, jsonUrl) {
    try {
      const response = await fetch(jsonUrl);
      if (!response.ok) {
        throw new Error(`Không thể tải file ${jsonUrl}`);
      }
      const pointsData = await response.json();
      console.log(`Đã nạp thành công ${pointsData.length} điểm cao độ cho dự án: ${projKey}.`);

      this.projects[projKey] = {
        pointsData: pointsData,
        entities: [],
        userVisible: true // Mặc định bật hiển thị từ UI cho từng dự án
      };

      // Tạo các thực thể điểm (markers) trên bản đồ
      this.createElevationEntities(projKey);

      // Thiết lập lắng nghe camera và click (chỉ làm 1 lần duy nhất)
      if (!this.listenersSetup) {
        this.setupListeners();
        this.listenersSetup = true;
      }

      // Cập nhật trạng thái hiển thị của các điểm đo
      this.updateVisibility();
    } catch (err) {
      console.error(`Lỗi khi nạp dữ liệu cao độ cho dự án ${projKey}:`, err);
    }
  }

  /**
   * Tạo cấu trúc HTML cho popup hiển thị thông tin độ cao
   */
  initPopupDOM() {
    if (document.getElementById("elevationPopup")) return;
    
    const popupHtml = `
      <div id="elevationPopup" class="elevation-popup">
        <div class="popup-close" id="popupCloseBtn">&times;</div>
        <div class="popup-title">Điểm độ cao (ID: <span id="popupPointId">-</span>)</div>
        <div class="popup-body">
          <div class="popup-row">
            <span class="popup-label">Cao độ:</span>
            <span class="popup-value" id="popupPointElevation">-</span>
          </div>
          <div class="popup-row">
            <span class="popup-label">Tọa độ GPS:</span>
            <span class="popup-value" id="popupPointGps">-</span>
          </div>
        </div>
        <div class="popup-actions">
          <button class="btn-popup-action btn-popup-edit" id="popupEditBtn">Chỉnh sửa</button>
          <button class="btn-popup-action btn-popup-delete" id="popupDeleteBtn">Xóa</button>
        </div>
      </div>
    `;
    
    const div = document.createElement("div");
    div.innerHTML = popupHtml.trim();
    document.body.appendChild(div.firstChild);
    
    // Lắng nghe sự kiện đóng popup
    document.getElementById("popupCloseBtn").addEventListener("click", () => {
      this.hidePopup();
    });
    
    // Gắn sự kiện click demo cho nút Chỉnh sửa và Xóa
    document.getElementById("popupEditBtn").addEventListener("click", () => {
      alert("Tính năng Chỉnh sửa điểm đo độ cao (Demo)");
    });
    
    document.getElementById("popupDeleteBtn").addEventListener("click", () => {
      alert("Tính năng Xóa điểm đo độ cao (Demo)");
    });
    
    this.popupElement = document.getElementById("elevationPopup");
  }

  /**
   * Vẽ hình ảnh marker ghim bong bóng màu cam chứa số bằng HTML5 Canvas
   */
  createMarkerImage(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    
    // Vẽ bóng mờ phía dưới ghim
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 4;
    
    // Vẽ bong bóng ghim màu cam
    ctx.beginPath();
    ctx.arc(24, 18, 13, 0, 2 * Math.PI);
    ctx.fillStyle = "#F05A28"; // Màu cam đặc trưng
    ctx.fill();
    
    // Vẽ mũi nhọn phía dưới bong bóng
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.moveTo(15, 25);
    ctx.lineTo(24, 39);
    ctx.lineTo(33, 25);
    ctx.closePath();
    ctx.fillStyle = "#F05A28";
    ctx.fill();
    
    // Vẽ viền trắng xung quanh vòng tròn
    ctx.beginPath();
    ctx.arc(24, 18, 13, 0, 2 * Math.PI);
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Vẽ chữ số ID màu trắng ở giữa bong bóng
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 24, 18);
    
    return canvas.toDataURL();
  }

  /**
   * Tạo các entity điểm đo độ cao thực tế trên bản đồ cho một dự án cụ thể
   * @param {string} projKey Mã định danh dự án
   */
  createElevationEntities(projKey) {
    const proj = this.projects[projKey];
    if (!proj) return;

    proj.pointsData.forEach(point => {
      const position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0);
      const markerImage = this.createMarkerImage(point.id.toString());
      
      const entity = this.viewer.entities.add({
        position: position,
        billboard: {
          image: markerImage,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          width: 38,
          height: 38,
          disableDepthTestDistance: Number.POSITIVE_INFINITY // Đảm bảo marker luôn nổi trên địa hình
        },
        properties: {
          isElevationPoint: true,
          projKey: projKey,
          pointId: point.id,
          elevation: point.elevation,
          lon: point.lon,
          lat: point.lat
        },
        show: false // Mặc định ẩn, sẽ được hiển thị khi chạy updateVisibility()
      });
      
      proj.entities.push(entity);
    });
  }

  /**
   * Thiết lập các bộ lắng nghe sự kiện
   */
  setupListeners() {
    this.viewer.camera.percentageChanged = 0.01;
    
    this.viewer.camera.changed.addEventListener(() => {
      this.updateVisibility();
    });
    
    // Lắng nghe sự kiện click chuột trái trên bản đồ để chọn điểm
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction(click => {
      const pickedObject = this.viewer.scene.pick(click.position);
      
      if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties && pickedObject.id.properties.isElevationPoint) {
        const entity = pickedObject.id;
        this.selectPoint(entity);
      } else {
        this.hidePopup();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    
    // Lắng nghe sự kiện render khung hình để cập nhật vị trí popup bám theo marker 3D
    this.viewer.scene.postRender.addEventListener(() => {
      this.updatePopupPosition();
    });
  }

  /**
   * Phương thức điều khiển bật/tắt hiển thị lớp điểm độ cao của dự án cụ thể từ UI
   * @param {string} projKey Mã định danh dự án
   * @param {boolean} visible Trạng thái hiển thị
   */
  setVisible(projKey, visible) {
    const proj = this.projects[projKey];
    if (proj) {
      proj.userVisible = visible;
      this.updateVisibility();
    }
  }

  /**
   * Cập nhật trạng thái ẩn/hiện của tất cả các điểm đo dựa trên mức zoom camera và nút điều khiển UI
   */
  updateVisibility() {
    const cameraHeight = this.viewer.camera.positionCartographic.height;
    const isZoomIn = cameraHeight <= this.zoomThreshold;
    
    for (const projKey in this.projects) {
      const proj = this.projects[projKey];
      const shouldShow = proj.userVisible && isZoomIn;
      
      proj.entities.forEach(entity => {
        if (entity.show !== shouldShow) {
          entity.show = shouldShow;
        }
      });
    }

    // Nếu điểm đang được chọn bị ẩn đi (do zoom out hoặc người dùng tắt lớp tương ứng), ẩn popup
    if (this.selectedEntity) {
      const isVisible = this.selectedEntity.show;
      if (!isVisible) {
        this.hidePopup();
      }
    }
  }

  /**
   * Chọn một điểm đo độ cao và hiển thị popup thông tin
   */
  selectPoint(entity) {
    this.selectedEntity = entity;
    const props = entity.properties;
    
    // Định dạng ID điểm kèm theo mã dự án viết tắt
    const cleanProjName = props.projKey.getValue().replace("Duong4KDC_", "").replace("_CCHaiThanh", "");
    document.getElementById("popupPointId").innerText = `${props.pointId.getValue()} (${cleanProjName})`;
    document.getElementById("popupPointElevation").innerText = `${props.elevation.getValue().toFixed(2)} m`;
    
    const latDMS = this.decToDMS(props.lat.getValue(), true);
    const lonDMS = this.decToDMS(props.lon.getValue(), false);
    document.getElementById("popupPointGps").innerText = `${latDMS} ${lonDMS}`;
    
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
   * Cập nhật tọa độ màn hình (2D Pixel) của popup dựa vào vị trí 3D của Entity
   */
  updatePopupPosition() {
    if (!this.selectedEntity || this.popupElement.style.display === "none") return;
    
    const position = this.selectedEntity.position.getValue(this.viewer.clock.currentTime);
    if (!position) return;
    
    const canvasPosition = this.viewer.scene.cartesianToCanvasCoordinates(position, new Cesium.Cartesian2());
    if (Cesium.defined(canvasPosition)) {
      this.popupElement.style.left = `${canvasPosition.x - this.popupElement.offsetWidth / 2}px`;
      this.popupElement.style.top = `${canvasPosition.y - this.popupElement.offsetHeight - 45}px`;
    } else {
      this.popupElement.style.display = "none";
    }
  }

  /**
   * Hàm chuyển đổi tọa độ thập phân sang Độ-Phút-Giây (DMS)
   */
  decToDMS(val, isLat) {
    const absolute = Math.abs(val);
    const degrees = Math.floor(absolute);
    const minutesNotTruncated = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesNotTruncated);
    const seconds = Math.floor((minutesNotTruncated - minutes) * 60);
    
    const direction = isLat ? (val >= 0 ? "N" : "S") : (val >= 0 ? "E" : "W");
    
    return `${degrees}° ${minutes}' ${seconds < 10 ? '0' : ''}${seconds}" ${direction}`;
  }
}

// Gán toàn cục để sử dụng trong app.js
window.ElevationTool = ElevationTool;
