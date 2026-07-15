// Danh sách dự án GIS được tải động từ database (bảng "projects") qua API /api/projects,
// không còn khai báo cứng trong code nữa — thêm dự án mới chỉ cần chạy process_all_tifs.js.
let projectsConfig = {};
let groupsConfig = [];
let viewer, mapManager, measureTool, elevationTool, parcelTool, defaultRect;

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

  // Lớp ranh giới thửa đất — dữ liệu tĩnh phủ toàn khu vực, không thuộc dự án nào
  parcelTool = new ParcelTool(viewer);
  parcelTool.load("/Apps/SampleData/ThuaDat.geojson");

  // 5. Dựng UI danh sách dự án + gắn toàn bộ sự kiện
  renderProjectList(groupsConfig);
  attachProjectEvents();
  attachStaticUiEvents();
}

document.addEventListener("DOMContentLoaded", init);
