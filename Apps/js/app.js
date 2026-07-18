// Danh sách dự án GIS được tải động từ database (bảng "projects") qua API /api/projects,
// không còn khai báo cứng trong code nữa — thêm dự án mới chỉ cần chạy process_all_tifs.js.
let projectsConfig = {};
let groupsConfig = [];
let viewer, mapManager, measureTool, elevationTool, parcelTool, roadTool, defaultRect;
let tanBinhLayers = {}; // { qhCnsdd, longDuong, tuyenDuong, timDuong, tenDuong, ranhB }

function buildProjectsConfig(rows) {
  const config = {};
  for (const row of rows) {
    config[row.project_key] = {
      name: row.project_key,
      title: row.title,
      // Ảnh tile lấy từ PostgreSQL (bảng "tiles") qua API /tiles/, không đọc từ folder "anh/"
      flycamUrl: `/tiles/${row.project_key}`,
      minZoom: row.min_zoom,
      maxZoom: row.max_zoom,
      // Bbox WGS84 thật, lấy từ GDAL (chuyển đổi EPSG:9210 VN-2000/TM-3 105-45 -> EPSG:4326)
      boundaryCoords: [row.west, row.south, row.east, row.north],
    };
  }
  return config;
}

// Gom các dự án thành nhóm theo group_key (null = hiển thị riêng lẻ)
function buildGroups(rows) {
  const groupMap = new Map();
  const ungrouped = [];
  for (const row of rows) {
    if (row.group_key) {
      if (!groupMap.has(row.group_key)) {
        groupMap.set(row.group_key, { groupKey: row.group_key, title: row.group_title, projects: [] });
      }
      groupMap.get(row.group_key).projects.push(row.project_key);
    } else {
      ungrouped.push({ groupKey: null, title: row.title, projects: [row.project_key] });
    }
  }
  return [...groupMap.values(), ...ungrouped];
}

// Tính bbox bao phủ toàn bộ các project trong nhóm
function groupBbox(group) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const pk of group.projects) {
    const p = projectsConfig[pk];
    if (!p) continue;
    const [pw, ps, pe, pn] = p.boundaryCoords;
    w = Math.min(w, pw); s = Math.min(s, ps);
    e = Math.max(e, pe); n = Math.max(n, pn);
  }
  return w === Infinity ? null : [w, s, e, n];
}

// Dựng động khối UI — 1 nút per nhóm (hoặc per dự án đơn lẻ)
function renderProjectList(groups) {
  const container = document.getElementById("projectList");
  if (!container) return;
  container.innerHTML = "";

  for (const group of groups) {
    const id = group.groupKey || group.projects[0];
    const el = document.createElement("div");
    el.className = "project-group";
    el.innerHTML = `
      <div class="project-header">
        <div class="project-info-click" data-group-id="${id}" title="Click để bay về vùng này">
          <svg class="project-icon" viewBox="0 0 24 24">
            <path d="M12 2L2 22h20L12 2zm0 3.99L19.53 19H4.47L12 5.99z"/>
          </svg>
          <span>${group.title}</span>
        </div>
        <div class="project-toggle-btn" title="Đóng/Mở lớp dữ liệu">
          <svg class="arrow-icon" viewBox="0 0 24 24">
            <path d="M7 10l5 5 5-5z"/>
          </svg>
        </div>
      </div>
      <div class="project-layers">
        <label class="menu-checkbox-item">
          <input type="checkbox" id="flycam_group_${id}" checked>
          <span class="custom-checkbox"></span>
          <span>Ảnh Flycam</span>
        </label>
      </div>
    `;
    container.appendChild(el);
  }
}

// Gắn sự kiện cho các phần tử UI vừa dựng động (theo nhóm)
function attachProjectEvents() {
  document.querySelectorAll(".project-info-click").forEach((infoDiv) => {
    infoDiv.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = infoDiv.getAttribute("data-group-id");
      const group = groupsConfig.find(g => (g.groupKey || g.projects[0]) === id);
      if (!group) return;
      const bbox = groupBbox(group);
      if (bbox) {
        viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(...bbox), duration: 2.0 });
      }
    });
  });

  document.querySelectorAll(".project-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const group = btn.closest(".project-group");
      if (group) group.classList.toggle("collapsed");
    });
  });

  for (const group of groupsConfig) {
    const id = group.groupKey || group.projects[0];
    const cb = document.getElementById(`flycam_group_${id}`);
    if (cb) {
      cb.addEventListener("change", (e) => {
        for (const projKey of group.projects) {
          mapManager.setFlycamVisible(projKey, e.target.checked);
        }
      });
    }
  }
}

// Gắn sự kiện cho các nút/UI tĩnh không phụ thuộc danh sách dự án
function attachStaticUiEvents() {
  // ==========================================
  // XỬ LÝ THANH CÔNG CỤ BÊN TRÁI (LEFT TOOLBAR)
  // ==========================================

  const btnFilter = document.getElementById("btnFilter");
  const gisPopupMenu = document.getElementById("gisPopupMenu");

  const btnLocate = document.getElementById("btnLocate");
  const locateDropdown = document.getElementById("locateDropdown");
  if (btnLocate && locateDropdown) {
    btnLocate.addEventListener("click", (e) => {
      e.stopPropagation();
      // Đóng menu lớp dữ liệu nếu đang mở, tránh 2 menu chồng lên nhau
      gisPopupMenu?.classList.remove("active");
      btnFilter?.classList.remove("active");

      btnLocate.classList.toggle("active");
      locateDropdown.classList.toggle("active");
    });

    document.getElementById("btnLocateFlycam")?.addEventListener("click", () => {
      if (defaultRect) {
        viewer.camera.setView({ destination: defaultRect });
      }
      locateDropdown.classList.remove("active");
      btnLocate.classList.remove("active");
    });

    document.getElementById("btnLocateParcel")?.addEventListener("click", () => {
      if (parcelTool) {
        viewer.camera.setView({ destination: parcelTool.bbox });
      }
      locateDropdown.classList.remove("active");
      btnLocate.classList.remove("active");
    });

    document.getElementById("btnLocateRoad")?.addEventListener("click", () => {
      if (roadTool) {
        viewer.camera.setView({ destination: roadTool.bbox });
      }
      locateDropdown.classList.remove("active");
      btnLocate.classList.remove("active");
    });

    document.addEventListener("click", (e) => {
      if (!locateDropdown.contains(e.target) && e.target !== btnLocate && !btnLocate.contains(e.target)) {
        locateDropdown.classList.remove("active");
        btnLocate.classList.remove("active");
      }
    });
  }

  if (btnFilter && gisPopupMenu) {
    btnFilter.addEventListener("click", (e) => {
      e.stopPropagation();
      // Đóng menu định vị nếu đang mở, tránh 2 menu chồng lên nhau
      locateDropdown?.classList.remove("active");
      btnLocate?.classList.remove("active");

      btnFilter.classList.toggle("active");
      gisPopupMenu.classList.toggle("active");
    });

    document.addEventListener("click", (e) => {
      if (!gisPopupMenu.contains(e.target) && e.target !== btnFilter && !btnFilter.contains(e.target)) {
        gisPopupMenu.classList.remove("active");
        btnFilter.classList.remove("active");
      }
    });
  }

  const baseMapRadios = document.getElementsByName("baseMapRadio");
  baseMapRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.checked) {
        mapManager.setBaseMap(e.target.value);
      }
    });
  });

  // ==========================================
  // XỬ LÝ THANH CÔNG CỤ BÊN PHẢI (RIGHT TOOLBAR)
  // ==========================================

  const btnFullScreen = document.getElementById("btnFullScreen");
  if (btnFullScreen) {
    btnFullScreen.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
          btnFullScreen.classList.add("active");
        }).catch((err) => {
          console.error(`Không thể bật chế độ toàn màn hình: ${err.message}`);
        });
      } else {
        document.exitFullscreen().then(() => {
          btnFullScreen.classList.remove("active");
        });
      }
    });

    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement) {
        btnFullScreen.classList.add("active");
      } else {
        btnFullScreen.classList.remove("active");
      }
    });
  }

  const btnZoomIn = document.getElementById("btnZoomIn");
  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      const cameraHeight = viewer.camera.positionCartographic.height;
      viewer.camera.zoomIn(cameraHeight * 0.25);
    });
  }

  const btnZoomOut = document.getElementById("btnZoomOut");
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      const cameraHeight = viewer.camera.positionCartographic.height;
      viewer.camera.zoomOut(cameraHeight * 0.25);
    });
  }

  const btnDistance = document.getElementById("btnDistance");
  const btnFinishMeasure = document.getElementById("btnFinishMeasure");

  if (btnDistance) {
    btnDistance.addEventListener("click", () => {
      if (btnDistance.classList.contains("active")) {
        resetActiveMeasureButtons();
        measureTool.clearDistance();
        if (btnFinishMeasure) btnFinishMeasure.style.display = "none";
      } else {
        resetActiveMeasureButtons();
        btnDistance.classList.add("active");
        measureTool.activate("distance");
        if (btnFinishMeasure) btnFinishMeasure.style.display = "block";
      }
    });
  }

  const btnArea = document.getElementById("btnArea");
  if (btnArea) {
    btnArea.addEventListener("click", () => {
      if (btnArea.classList.contains("active")) {
        resetActiveMeasureButtons();
        measureTool.clearArea();
        if (btnFinishMeasure) btnFinishMeasure.style.display = "none";
      } else {
        resetActiveMeasureButtons();
        btnArea.classList.add("active");
        measureTool.activate("area");
        if (btnFinishMeasure) btnFinishMeasure.style.display = "block";
      }
    });
  }

  const btnClearMeasure = document.getElementById("btnClearMeasure");
  if (btnClearMeasure) {
    btnClearMeasure.addEventListener("click", () => {
      measureTool.clearDistance();
      measureTool.clearArea();
      resetActiveMeasureButtons();
      if (btnFinishMeasure) btnFinishMeasure.style.display = "none";
    });
  }

  if (btnFinishMeasure) {
    btnFinishMeasure.addEventListener("click", () => {
      measureTool.finishMeasurement();
      resetActiveMeasureButtons();
      btnFinishMeasure.style.display = "none";
    });
  }

  const chkParcelLayer = document.getElementById("chkParcelLayer");
  if (chkParcelLayer) {
    chkParcelLayer.addEventListener("change", (e) => {
      parcelTool.setVisible(e.target.checked);
    });
  }

  const chkRoadLayer = document.getElementById("chkRoadLayer");
  if (chkRoadLayer) {
    chkRoadLayer.addEventListener("change", (e) => {
      roadTool.setVisible(e.target.checked);
    });
  }

  // 6 checkbox lớp dữ liệu Tân Bình, ánh xạ id DOM -> key trong tanBinhLayers
  const tanBinhCheckboxMap = {
    chkQhCnsddLayer: "qhCnsdd",
    chkLongDuongLayer: "longDuong",
    chkTuyenDuongLayer: "tuyenDuong",
    chkTimDuongLayer: "timDuong",
    chkTenDuongLayer: "tenDuong",
    chkRanhBLayer: "ranhB",
  };
  for (const [checkboxId, layerKey] of Object.entries(tanBinhCheckboxMap)) {
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
      checkbox.addEventListener("change", (e) => {
        tanBinhLayers[layerKey]?.setVisible(e.target.checked);
      });
    }
  }
}

/**
 * Đặt lại trạng thái active của các nút đo đạc trên giao diện
 */
function resetActiveMeasureButtons() {
  document.getElementById("btnDistance")?.classList.remove("active");
  document.getElementById("btnArea")?.classList.remove("active");
}

async function init() {
  // 1. Tải danh sách dự án từ database
  const response = await fetch("/api/projects");
  const rows = await response.json();
  projectsConfig = buildProjectsConfig(rows);
  groupsConfig = buildGroups(rows);

  // 2. Khởi tạo đối tượng Cesium Viewer
  viewer = new Cesium.Viewer("cesiumContainer", {
    baseLayerPicker: false,
    geocoder: false,
    navigationHelpButton: false,
    homeButton: false,
    sceneModePicker: false,
    timeline: false,
    animation: false,
    infoBox: false,
    selectionIndicator: false,
    creditContainer: document.createElement("div"),
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });

  // 3. Cho camera bay tới bbox của nhóm đầu tiên khi load trang
  const firstGroup = groupsConfig[0];
  if (firstGroup) {
    const bbox = groupBbox(firstGroup);
    if (bbox) {
      defaultRect = Cesium.Rectangle.fromDegrees(...bbox);
      viewer.camera.setView({ destination: defaultRect });
    }
  }

  // 4. Khởi tạo các module quản lý bản đồ
  mapManager = new MapManager(viewer, projectsConfig);
  measureTool = new MeasureTool(viewer);
  elevationTool = new ElevationTool(viewer);

  for (const key in projectsConfig) {
    if (projectsConfig[key].elevationJson) {
      elevationTool.addProject(key, projectsConfig[key].elevationJson);
    }
  }

  // Lớp ranh giới thửa đất + giao thông dạng vùng — tạm tắt hiển thị theo yêu cầu sếp.
  // Dữ liệu (ThuaDat.geojson, GiaoThong.geojson) và code (ParcelTool.js, RoadTool.js)
  // vẫn còn nguyên, chỉ cần bỏ comment 4 dòng dưới để bật lại.
  // parcelTool = new ParcelTool(viewer);
  // parcelTool.load("/Apps/SampleData/ThuaDat.geojson");
  // roadTool = new RoadTool(viewer);
  // roadTool.load("/Apps/SampleData/GiaoThong.geojson");

  // 6 lớp dữ liệu quy hoạch/hạ tầng Tân Bình — dữ liệu tĩnh phủ toàn khu vực, không thuộc dự án nào.
  // Dùng chung 1 class VectorLayerTool thay vì viết riêng 6 class (xem Apps/js/VectorLayerTool.js).
  tanBinhLayers.qhCnsdd = new VectorLayerTool(viewer, {
    id: "qhCnsdd",
    hasPopup: true,
    popupTitle: "Quy hoạch sử dụng đất",
    popupFields: [
      { field: "CNSDD_QD", label: "Chức năng quy hoạch" },
      { field: "CNSDD_CD", label: "Mã chức năng" },
      { field: "Dtich", label: "Diện tích", format: (v) => (v != null ? `${v.toFixed(1)} m²` : "-") },
    ],
    loadOptions: {
      stroke: Cesium.Color.fromCssColorString("#A855F7"),
      strokeWidth: 1,
      fill: Cesium.Color.fromCssColorString("#A855F7").withAlpha(0.15),
      clampToGround: true,
    },
  });
  tanBinhLayers.qhCnsdd.load("/Apps/SampleData/QH_CNSDD_TanBinh.geojson");

  tanBinhLayers.longDuong = new VectorLayerTool(viewer, {
    id: "longDuong",
    hasPopup: true,
    popupTitle: "Lòng đường",
    popupFields: [{ field: "TenDuong", label: "Tên đường" }],
    loadOptions: {
      stroke: Cesium.Color.fromCssColorString("#F97316"),
      strokeWidth: 2,
      clampToGround: true,
    },
  });
  tanBinhLayers.longDuong.load("/Apps/SampleData/LongDuong_TanBinh.geojson");

  tanBinhLayers.tuyenDuong = new VectorLayerTool(viewer, {
    id: "tuyenDuong",
    hasPopup: true,
    popupTitle: "Tuyến đường",
    popupFields: [
      { field: "Shape_Leng", label: "Chiều dài", format: (v) => (v != null ? `${v.toFixed(1)} m` : "-") },
    ],
    loadOptions: {
      stroke: Cesium.Color.fromCssColorString("#14B8A6"),
      strokeWidth: 2,
      clampToGround: true,
    },
  });
  tanBinhLayers.tuyenDuong.load("/Apps/SampleData/TuyenDuong_TanBinh.geojson");

  tanBinhLayers.timDuong = new VectorLayerTool(viewer, {
    id: "timDuong",
    hasPopup: true,
    popupTitle: "Tim đường",
    popupFields: [
      { field: "Shape_Leng", label: "Chiều dài", format: (v) => (v != null ? `${v.toFixed(1)} m` : "-") },
    ],
    loadOptions: {
      stroke: Cesium.Color.fromCssColorString("#EC4899"),
      strokeWidth: 1,
      clampToGround: true,
    },
  });
  tanBinhLayers.timDuong.load("/Apps/SampleData/TimDuong_TanBinh.geojson");

  tanBinhLayers.tenDuong = new VectorLayerTool(viewer, {
    id: "tenDuong",
    hasPopup: true,
    popupTitle: "Tên đường",
    popupFields: [{ field: "TenDuong", label: "Tên đường" }],
    loadOptions: {
      markerColor: Cesium.Color.fromCssColorString("#22C55E"),
      markerSize: 24,
      clampToGround: true,
    },
  });
  tanBinhLayers.tenDuong.load("/Apps/SampleData/TenDuong_P.geojson");

  // Chỉ vẽ viền ranh giới, không tô màu, không cần popup (chỉ có 1 polygon, không có thuộc tính hữu ích)
  tanBinhLayers.ranhB = new VectorLayerTool(viewer, {
    id: "ranhB",
    hasPopup: false,
    loadOptions: {
      stroke: Cesium.Color.fromCssColorString("#DC2626"),
      strokeWidth: 3,
      fill: Cesium.Color.TRANSPARENT,
      clampToGround: true,
    },
  });
  tanBinhLayers.ranhB.load("/Apps/SampleData/RanhBTanHCM.geojson");

  // 5. Dựng UI danh sách dự án + gắn toàn bộ sự kiện
  renderProjectList(groupsConfig);
  attachProjectEvents();
  attachStaticUiEvents();
}

document.addEventListener("DOMContentLoaded", init);
