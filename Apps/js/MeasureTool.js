/**
 * Lớp đại diện cho một lượt đo khoảng cách (Distance)
 */
class DistanceMeasurement {
  constructor(viewer, points) {
    this.viewer = viewer;
    this.points = points; // Mảng Cartesian3 các điểm đỉnh

    this.polylineEntity = null;
    this.vertexEntities = [];
    this.segmentLabelEntities = [];

    this.createEntities();
  }

  createEntities() {
    // 1. Vẽ đường line tĩnh có CallbackProperty liên kết động theo mảng points
    this.polylineEntity = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.points, false),
        width: 4.0,
        material: Cesium.Color.YELLOW,
        clampToGround: true
      }
    });

    // 2. Tạo đỉnh chấm tròn đỏ cho phép kéo thả
    this.points.forEach((pt, idx) => {
      const vEntity = this.viewer.entities.add({
        position: new Cesium.CallbackProperty(() => this.points[idx], false),
        point: {
          color: Cesium.Color.RED,
          pixelSize: 12,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });

      // Gán metadata nhận diện kéo thả
      vEntity.isVertex = true;
      vEntity.vertexIndex = idx;
      vEntity.measurement = this;

      this.vertexEntities.push(vEntity);
    });

    // 3. Khởi tạo nhãn số đo
    this.updateLabels();
  }

  updateLabels() {
    // Xóa nhãn cũ
    this.segmentLabelEntities.forEach(e => this.viewer.entities.remove(e));
    this.segmentLabelEntities = [];

    let totalDist = 0;
    
    // Vẽ nhãn cho điểm đầu tiên
    if (this.points.length > 0) {
      const labelEntity = this.viewer.entities.add({
        position: this.points[0],
        label: {
          text: " Bắt đầu ",
          font: "bold 13px sans-serif",
          fillColor: Cesium.Color.WHITE,
          style: Cesium.LabelStyle.FILL,
          showBackground: true,
          backgroundColor: new Cesium.Color(0.1, 0.1, 0.1, 0.8),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          pixelOffset: new Cesium.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      this.segmentLabelEntities.push(labelEntity);
    }

    // Vẽ nhãn khoảng cách tích lũy cho các điểm tiếp theo
    for (let i = 1; i < this.points.length; i++) {
      const segmentDist = Cesium.Cartesian3.distance(this.points[i - 1], this.points[i]);
      totalDist += segmentDist;

      const labelText = ` + ${segmentDist.toFixed(1)} m \n Tổng: ${totalDist.toFixed(1)} m `;

      const labelEntity = this.viewer.entities.add({
        position: this.points[i],
        label: {
          text: labelText,
          font: "bold 13px sans-serif",
          fillColor: Cesium.Color.YELLOW,
          style: Cesium.LabelStyle.FILL,
          showBackground: true,
          backgroundColor: new Cesium.Color(0.08, 0.1, 0.15, 0.85),
          backgroundPadding: new Cesium.Cartesian2(8, 6),
          pixelOffset: new Cesium.Cartesian2(0, -25),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      this.segmentLabelEntities.push(labelEntity);
    }
  }

  destroy() {
    this.viewer.entities.remove(this.polylineEntity);
    this.vertexEntities.forEach(e => this.viewer.entities.remove(e));
    this.segmentLabelEntities.forEach(e => this.viewer.entities.remove(e));
  }
}

/**
 * Lớp đại diện cho một lượt đo diện tích đa giác (Polygon)
 */
class PolygonMeasurement {
  constructor(viewer, points) {
    this.viewer = viewer;
    this.points = points;

    this.polygonEntity = null;
    this.polylineBorderEntity = null;
    this.vertexEntities = [];
    this.sideLabelEntities = [];
    this.centerLabelEntity = null;

    this.createEntities();
  }

  createEntities() {
    // 1. Vẽ đa giác tĩnh liên kết động theo mảng points
    this.polygonEntity = this.viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(this.points), false),
        material: Cesium.Color.RED.withAlpha(0.25),
        classificationType: Cesium.ClassificationType.TERRAIN
      }
    });

    // 2. Vẽ đường viền đỏ dày sắc nét bao quanh đa giác
    this.polylineBorderEntity = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => [...this.points, this.points[0]], false),
        width: 4.0,
        material: Cesium.Color.RED,
        clampToGround: true
      }
    });

    // 3. Tạo các đỉnh tròn đỏ cho phép kéo thả
    this.points.forEach((pt, idx) => {
      const vEntity = this.viewer.entities.add({
        position: new Cesium.CallbackProperty(() => this.points[idx], false),
        point: {
          color: Cesium.Color.RED,
          pixelSize: 12,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });

      // Gán metadata kéo thả
      vEntity.isVertex = true;
      vEntity.vertexIndex = idx;
      vEntity.measurement = this;

      this.vertexEntities.push(vEntity);
    });

    // 4. Vẽ nhãn diện tích và nhãn đo các cạnh
    this.updateLabels();
  }

  updateLabels() {
    // Xóa các nhãn cũ
    this.sideLabelEntities.forEach(e => this.viewer.entities.remove(e));
    this.sideLabelEntities = [];

    if (this.centerLabelEntity) {
      this.viewer.entities.remove(this.centerLabelEntity);
      this.centerLabelEntity = null;
    }

    const len = this.points.length;
    if (len < 3) return;

    // A. Vẽ nhãn đo độ dài của TỪNG CẠNH
    for (let i = 0; i < len; i++) {
      const p1 = this.points[i];
      const p2 = this.points[(i + 1) % len];
      const dist = Cesium.Cartesian3.distance(p1, p2);
      
      // Trung điểm cạnh để gắn nhãn
      const midpoint = Cesium.Cartesian3.midpoint(p1, p2, new Cesium.Cartesian3());

      const labelText = ` ${dist.toFixed(1)} m `;
      const sideLabel = this.viewer.entities.add({
        position: midpoint,
        label: {
          text: labelText,
          font: "bold 12px sans-serif",
          fillColor: Cesium.Color.WHITE,
          style: Cesium.LabelStyle.FILL,
          showBackground: true,
          backgroundColor: new Cesium.Color(0.1, 0.1, 0.1, 0.75), // Nền xám mờ nhẹ
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      this.sideLabelEntities.push(sideLabel);
    }

    // B. Tính diện tích đa giác phẳng
    const area = this.calculateArea();
    const centroid = this.calculateCentroid();

    const areaText = area > 1000000 
      ? ` ${(area / 1000000).toFixed(3)} km² ` 
      : ` ${area.toFixed(1)} m² `;

    // Vẽ nhãn DIỆN TÍCH ở tâm đa giác phong cách PREMIUM (Màu xanh dương giống ảnh mẫu)
    this.centerLabelEntity = this.viewer.entities.add({
      position: centroid,
      label: {
        text: areaText,
        font: "bold 15px sans-serif",
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        showBackground: true,
        backgroundColor: new Cesium.Color(0.15, 0.45, 0.85, 0.95), // Màu xanh Royal Blue giống hệt thiết kế mẫu
        backgroundPadding: new Cesium.Cartesian2(12, 8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
  }

  calculateArea() {
    const coords = this.points.map(p => {
      const cartographic = Cesium.Cartographic.fromCartesian(p);
      return {
        lat: cartographic.latitude,
        lon: cartographic.longitude
      };
    });

    const R = 6378137;
    let area = 0;
    const len = coords.length;
    const latRef = coords[0].lat;
    const lonRef = coords[0].lon;
    
    const projectedPoints = coords.map(coord => {
      const x = R * (coord.lon - lonRef) * Math.cos(latRef);
      const y = R * (coord.lat - latRef);
      return { x, y };
    });

    for (let i = 0; i < len; i++) {
      const p1 = projectedPoints[i];
      const p2 = projectedPoints[(i + 1) % len];
      area += (p1.x * p2.y) - (p2.x * p1.y);
    }
    
    return Math.abs(area / 2);
  }

  calculateCentroid() {
    let x = 0, y = 0, z = 0;
    this.points.forEach(p => {
      x += p.x;
      y += p.y;
      z += p.z;
    });
    const len = this.points.length;
    return new Cesium.Cartesian3(x / len, y / len, z / len);
  }

  destroy() {
    this.viewer.entities.remove(this.polygonEntity);
    this.viewer.entities.remove(this.polylineBorderEntity);
    this.vertexEntities.forEach(e => this.viewer.entities.remove(e));
    this.sideLabelEntities.forEach(e => this.viewer.entities.remove(e));
    if (this.centerLabelEntity) this.viewer.entities.remove(this.centerLabelEntity);
  }
}

/**
 * Lớp điều khiển công cụ đo đạc chính
 */
class MeasureTool {
  constructor(viewer) {
    this.viewer = viewer;
    this.activeMode = null;
    this.handler = null; // Trình xử lý sự kiện click vẽ

    this.points = [];
    this.mousePoint = null;
    
    this.activeEntities = []; // Thực thể vẽ nháp trong lúc đo
    this.savedMeasurements = []; // Lưu trữ các đối tượng đo đã chốt

    // Trình xử lý sự kiện KÉO THẢ ĐỈNH đa dạng
    this.dragHandler = null;
    this.isDragging = false;
    this.draggedVertex = null; // Đỉnh đang bị kéo

    // Tắt hành vi click đúp zoom mặc định của Cesium để không bị giật bản đồ khi chốt đo
    this.viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    this.initDragAndDrop();
  }

  /**
   * Khởi tạo tính năng kéo thả (Drag and Drop) đỉnh đa giác
   */
  initDragAndDrop() {
    this.dragHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    // 1. LEFT_DOWN: Bắt đầu giữ chuột vào đỉnh chấm tròn đỏ
    this.dragHandler.setInputAction((clickEvent) => {
      const pickedObject = this.viewer.scene.pick(clickEvent.position);
      
      if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.isVertex) {
        // Tắt camera control để không bị trượt bản đồ khi đang kéo đỉnh
        this.viewer.scene.screenSpaceCameraController.enableRotate = false;
        this.viewer.scene.screenSpaceCameraController.enableTranslate = false;

        this.isDragging = true;
        this.draggedVertex = pickedObject.id;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    // 2. MOUSE_MOVE: Di chuyển chuột cập nhật tọa độ đỉnh thời gian thực
    this.dragHandler.setInputAction((movement) => {
      if (this.isDragging && this.draggedVertex) {
        const cartesian = this.pickPosition(movement.endPosition);
        if (Cesium.defined(cartesian)) {
          const idx = this.draggedVertex.vertexIndex;
          const measurement = this.draggedVertex.measurement;

          // Cập nhật tọa độ đỉnh mới
          measurement.points[idx] = cartesian;

          // Cập nhật nhãn khoảng cách / diện tích thời gian thực
          measurement.updateLabels();

          // requestRenderMode không tự biết CallbackProperty vừa đổi giá trị -> ép vẽ lại
          this.viewer.scene.requestRender();
        }
      } else {
        // Đổi con trỏ chuột thành pointer khi rê vào đỉnh
        const pickedObject = this.viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.isVertex) {
          this.viewer.canvas.style.cursor = "pointer";
        } else {
          if (!this.activeMode) {
            this.viewer.canvas.style.cursor = "default";
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // 3. LEFT_UP: Nhả chuột để chốt vị trí đỉnh mới
    this.dragHandler.setInputAction(() => {
      if (this.isDragging) {
        this.isDragging = false;
        this.draggedVertex = null;

        // Bật lại camera control cho phép điều hướng bản đồ bình thường
        this.viewer.scene.screenSpaceCameraController.enableRotate = true;
        this.viewer.scene.screenSpaceCameraController.enableTranslate = true;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
  }

  activate(mode) {
    this.deactivate();
    this.activeMode = mode;

    this.viewer.canvas.style.cursor = "crosshair";
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    // Hiển thị nút "Chốt hình" trên giao diện UI
    const btnFinish = document.getElementById("btnFinishMeasure");
    if (btnFinish) btnFinish.style.display = "block";

    if (mode === "distance") {
      this.initDistanceMeasurement();
    } else if (mode === "area") {
      this.initAreaMeasurement();
    }
  }

  deactivate() {
    this.activeMode = null;
    this.viewer.canvas.style.cursor = "default";
    
    if (this.handler) {
      this.handler.destroy();
      this.handler = null;
    }

    // Ẩn nút "Chốt hình" trên giao diện UI
    const btnFinish = document.getElementById("btnFinishMeasure");
    if (btnFinish) btnFinish.style.display = "none";

    // Xóa các nét vẽ nháp
    this.activeEntities.forEach(e => this.viewer.entities.remove(e));
    this.activeEntities = [];

    this.points = [];
    this.mousePoint = null;
  }

  /**
   * Chốt đo đạc hiện tại bằng tay thông qua nút bấm UI
   */
  finishMeasurement() {
    if (this.activeMode === "distance" && this.points.length > 1) {
      const finalMeasurement = new DistanceMeasurement(this.viewer, [...this.points]);
      this.savedMeasurements.push(finalMeasurement);
    } else if (this.activeMode === "area" && this.points.length >= 3) {
      const finalMeasurement = new PolygonMeasurement(this.viewer, [...this.points]);
      this.savedMeasurements.push(finalMeasurement);
    }
    
    // Đặt lại giao diện active
    document.getElementById("btnDistance")?.classList.remove("active");
    document.getElementById("btnArea")?.classList.remove("active");

    this.deactivate();
  }

  clearDistance() {
    this.deactivate();
    // Xóa các lượt đo Distance trong mảng lưu trữ
    this.savedMeasurements = this.savedMeasurements.filter(m => {
      if (m instanceof DistanceMeasurement) {
        m.destroy();
        return false;
      }
      return true;
    });
  }

  clearArea() {
    this.deactivate();
    // Xóa các lượt đo Polygon trong mảng lưu trữ
    this.savedMeasurements = this.savedMeasurements.filter(m => {
      if (m instanceof PolygonMeasurement) {
        m.destroy();
        return false;
      }
      return true;
    });
  }

  // --- LOGIC VẼ NHÁP KHOẢNG CÁCH ---
  initDistanceMeasurement() {
    // Vẽ đường line nháp động theo con trỏ chuột
    const dynamicLine = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (this.points.length === 0) return [];
          const positions = [...this.points];
          if (this.mousePoint) positions.push(this.mousePoint);
          return positions;
        }, false),
        width: 3,
        material: Cesium.Color.YELLOW,
        clampToGround: true
      }
    });
    this.activeEntities.push(dynamicLine);

    // Đánh dấu click chuột & tự nhận diện kích đúp để chốt hình
    this.handler.setInputAction((clickEvent) => {
      const cartesian = this.pickPosition(clickEvent.position);
      if (Cesium.defined(cartesian)) {
        const now = Date.now();
        // Tự động nhận diện kích đúp siêu nhạy bằng khoảng cách thời gian (< 350ms)
        if (this.lastClickTime && (now - this.lastClickTime < 350)) {
          // Tính luôn điểm vừa click ở click 1 của cú đúp (không pop điểm click 1 nữa)
          // Chốt hình khoảng cách ngay lập tức
          this.finishMeasurement();
          this.lastClickTime = now;
          return;
        }

        this.lastClickTime = now;
        this.points.push(cartesian);

        // Vẽ point nháp tròn đỏ
        const pt = this.viewer.entities.add({
          position: cartesian,
          point: {
            color: Cesium.Color.RED,
            pixelSize: 8,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        });
        this.activeEntities.push(pt);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Di chuyển chuột
    this.handler.setInputAction((movement) => {
      if (this.points.length > 0) {
        const cartesian = this.pickPosition(movement.endPosition);
        if (Cesium.defined(cartesian)) {
          this.mousePoint = cartesian;
          // requestRenderMode không tự biết mousePoint vừa đổi -> ép vẽ lại đường nháp
          this.viewer.scene.requestRender();
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // --- LOGIC VẼ NHÁP DIỆN TÍCH ---
  initAreaMeasurement() {
    // Đa giác nháp động chạy theo con trỏ chuột
    const dynamicPolygon = this.viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.CallbackProperty(() => {
          if (this.points.length < 2) return null;
          const positions = [...this.points];
          if (this.mousePoint) positions.push(this.mousePoint);
          return new Cesium.PolygonHierarchy(positions);
        }, false),
        material: Cesium.Color.YELLOW.withAlpha(0.25),
        classificationType: Cesium.ClassificationType.TERRAIN
      }
    });
    this.activeEntities.push(dynamicPolygon);

    this.handler.setInputAction((clickEvent) => {
      const cartesian = this.pickPosition(clickEvent.position);
      if (Cesium.defined(cartesian)) {
        const now = Date.now();
        // Tự động nhận diện kích đúp siêu nhạy bằng khoảng cách thời gian (< 350ms)
        if (this.lastClickTime && (now - this.lastClickTime < 350)) {
          // Tính luôn điểm vừa click ở click 1 của cú đúp (không pop điểm click 1 nữa)
          // Chốt hình diện tích ngay lập tức
          this.finishMeasurement();
          this.lastClickTime = now;
          return;
        }

        this.lastClickTime = now;
        this.points.push(cartesian);

        // Chấm đỏ đỉnh nháp
        const pt = this.viewer.entities.add({
          position: cartesian,
          point: {
            color: Cesium.Color.RED,
            pixelSize: 8,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        });
        this.activeEntities.push(pt);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    this.handler.setInputAction((movement) => {
      if (this.points.length > 0) {
        const cartesian = this.pickPosition(movement.endPosition);
        if (Cesium.defined(cartesian)) {
          this.mousePoint = cartesian;
          // requestRenderMode không tự biết mousePoint vừa đổi -> ép vẽ lại vùng nháp
          this.viewer.scene.requestRender();
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  pickPosition(windowPosition) {
    if (this.viewer.scene.mode === Cesium.SceneMode.SCENE3D) {
      const ray = this.viewer.camera.getPickRay(windowPosition);
      return this.viewer.scene.globe.pick(ray, this.viewer.scene);
    }
    return this.viewer.camera.pickEllipsoid(windowPosition, this.viewer.scene.globe.ellipsoid);
  }
}

window.MeasureTool = MeasureTool;
window.DistanceMeasurement = DistanceMeasurement;
window.PolygonMeasurement = PolygonMeasurement;
