/**
 * Quản lý các lớp bản đồ, ảnh flycam, viền ranh giới và base maps cho nhiều dự án GIS
 */
class MapManager {
  /**
   * @param {Cesium.Viewer} viewer Đối tượng Cesium Viewer
   * @param {Object} projectsConfig Cấu hình thông tin của các dự án
   */
  constructor(viewer, projectsConfig) {
    this.viewer = viewer;
    this.projectsConfig = projectsConfig;
    this.projects = {};
    this.osmLayer = null;

    this.initLayers();
  }

  /**
   * Khởi tạo các lớp bản đồ, ảnh flycam và viền ranh giới của tất cả dự án
   */
  async initLayers() {
    // 1. Tạo lớp nền Raster (OpenStreetMap) ở chế độ ẩn mặc định
    try {
      this.osmLayer = this.viewer.imageryLayers.addImageryProvider(
        new Cesium.OpenStreetMapImageryProvider({
          url: "https://a.tile.openstreetmap.org/"
        })
      );
      this.osmLayer.show = false;
    } catch (e) {
      console.error("Lỗi khởi tạo OpenStreetMap layer:", e);
    }

    // 2. Khởi tạo dữ liệu hình ảnh & ranh giới cho từng dự án
    for (const key in this.projectsConfig) {
      const config = this.projectsConfig[key];
      this.projects[key] = {
        flycamLayer: null
      };

      // Nạp ảnh flycam từ thư mục tile XYZ (cắt bằng `gdal raster tile`) của từng dự án.
      // Dùng UrlTemplateImageryProvider với rectangle/tilingScheme khai báo rõ từ boundaryCoords
      // (không dùng TileMapServiceImageryProvider vì nó mặc định quy ước TMS/reverseY,
      // còn tile ở đây xuất theo quy ước XYZ chuẩn — không có tilemapresource.xml để tự dò).
      if (config.flycamUrl && config.boundaryCoords) {
        try {
          const rectangle = Cesium.Rectangle.fromDegrees(...config.boundaryCoords);
          const flycamProvider = new Cesium.UrlTemplateImageryProvider({
            url: `${config.flycamUrl}/{z}/{x}/{y}.png`,
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
            rectangle: rectangle,
            minimumLevel: config.minZoom ?? 0,
            maximumLevel: config.maxZoom,
          });
          const layer = this.viewer.imageryLayers.addImageryProvider(flycamProvider);
          layer.show = true; // Mặc định hiển thị ảnh flycam
          this.projects[key].flycamLayer = layer;
        } catch (error) {
          console.error(`Lỗi khi load ảnh flycam cho dự án ${key}:`, error);
        }
      }
    }
  }

  /**
   * Bật/Tắt hiển thị lớp ảnh flycam của dự án cụ thể
   * @param {string} projKey Mã định danh dự án
   * @param {boolean} visible Trạng thái hiển thị
   */
  setFlycamVisible(projKey, visible) {
    const proj = this.projects[projKey];
    if (proj && proj.flycamLayer) {
      proj.flycamLayer.show = visible;
    }
  }

  /**
   * Di chuyển camera đến vùng bao phủ của dự án cụ thể
   * @param {string} projKey Mã định danh dự án
   */
  flyToProject(projKey) {
    const config = this.projectsConfig[projKey];
    if (config && config.boundaryCoords) {
      const rectangle = Cesium.Rectangle.fromDegrees(
        config.boundaryCoords[0],
        config.boundaryCoords[1],
        config.boundaryCoords[2],
        config.boundaryCoords[3]
      );
      this.viewer.camera.flyTo({
        destination: rectangle,
        duration: 2.0 // Thời gian bay 2 giây
      });
    }
  }

  /**
   * Chuyển đổi bản đồ nền
   * @param {string} type 'satellite' (Vệ tinh) | 'street' (Đường phố)
   */
  setBaseMap(type) {
    if (!this.osmLayer) return;
    
    if (type === "street") {
      this.osmLayer.show = true;
    } else {
      this.osmLayer.show = false;
    }
  }
}

// Gán toàn cục để sử dụng trong app.js
window.MapManager = MapManager;
