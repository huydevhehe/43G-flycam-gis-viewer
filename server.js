import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { fileURLToPath, URL } from "url";

import chokidar from "chokidar";
import compression from "compression";
import express from "express";
import yargs from "yargs";

import ContextCache from "./scripts/ContextCache.js";
import createRoute from "./scripts/createRoute.js";
import pool from "./db.js";

import {
  createCesiumJs,
  createCombinedSpecList,
  glslToJavaScript,
  createIndexJs,
  buildCesium,
  buildEngine,
  buildWidgets,
} from "./scripts/build.js";

const argv = await yargs(process.argv)
  .options({
    port: {
      default: 3003,
      description: "Port to listen on.",
    },
    public: {
      type: "boolean",
      description: "Run a public server that listens on all interfaces.",
    },
    production: {
      type: "boolean",
      description: "If true, skip build step and serve existing built files.",
    },
  })
  .help().argv;

// These functions will not exist in the production zip file but they also won't be run
const { getSandcastleConfig, buildSandcastleGallery, buildSandcastleApp } =
  argv.production ? {} : await import("./scripts/buildSandcastle.js");

const outputDirectory = path.join("Build", "CesiumDev");

function formatTimeSinceInSeconds(start) {
  return Math.ceil((performance.now() - start) / 100) / 10;
}

/**
 * Returns CesiumJS bundles configured for development.
 *
 * @returns {Bundles} The bundles.
 */
async function generateDevelopmentBuild() {
  const startTime = performance.now();

  // Build @cesium/engine index.js
  console.log("[1/3] Building @cesium/engine...");
  const engineContexts = await buildEngine({
    incremental: true,
    minify: false,
    write: false,
  });

  // Build @cesium/widgets index.js
  console.log("[2/3] Building @cesium/widgets...");
  const widgetContexts = await buildWidgets({
    incremental: true,
    minify: false,
    write: false,
  });

  // Build CesiumJS and save returned contexts for rebuilding upon request
  console.log("[3/3] Building CesiumJS...");
  const contexts = await buildCesium({
    iife: true,
    incremental: true,
    minify: false,
    node: false,
    outputDirectory: outputDirectory,
    removePragmas: false,
    sourcemap: true,
    write: false,
  });

  console.log(
    `Cesium built in ${formatTimeSinceInSeconds(startTime)} seconds.`,
  );

  return { ...contexts, engine: engineContexts, widgets: widgetContexts };
}

// Delay execution of the callback until a short time has elapsed since it was last invoked, preventing
// calls to the same function in quick succession from triggering multiple builds.
const throttleDelay = 500;
const throttle = (callback) => {
  let timeout;
  return () =>
    new Promise((resolve) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        resolve(callback());
      }, throttleDelay);
    });
};

(async function () {
  const gzipHeader = Buffer.from("1F8B08", "hex");
  const production = argv.production;

  let contexts;
  if (!production) {
    contexts = await generateDevelopmentBuild();
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    if (
      buildSandcastleApp &&
      !fs.existsSync(path.join(__dirname, "/Apps/Sandcastle2/index.html"))
    ) {
      // Sandcastle takes a bit of time to build and is unlikely to change often
      // Only build it when we detect it doesn't exist to save on dev time
      console.log("Building Sandcastle...");
      const startTime = performance.now();
      await buildSandcastleApp({
        outputToBuildDir: false,
        includeDevelopment: true,
        outerOrigin: "http://localhost:8080",
        innerOrigin: "http://localhost:8081",
      });
      console.log(
        `Sandcastle built in ${formatTimeSinceInSeconds(startTime)} seconds.`,
      );
    }
  }

  const app = express();

  app.use(function (req, res, next) {
    // *NOTE* Any changes you make here must be mirrored in web.config.
    const extensionToMimeType = {
      ".czml": "application/json",
      ".json": "application/json",
      ".geojson": "application/json",
      ".topojson": "application/json",
      ".wasm": "application/wasm",
      ".ktx2": "image/ktx2",
      ".gltf": "model/gltf+json",
      ".bgltf": "model/gltf-binary",
      ".glb": "model/gltf-binary",
      ".b3dm": "application/octet-stream",
      ".pnts": "application/octet-stream",
      ".i3dm": "application/octet-stream",
      ".cmpt": "application/octet-stream",
      ".geom": "application/octet-stream",
      ".vctr": "application/octet-stream",
      ".glsl": "text/plain",
    };
    const extension = path.extname(req.url);
    if (extensionToMimeType[extension]) {
      res.contentType(extensionToMimeType[extension]);
    }
    next();
  });

  app.use(compression());
  //eslint-disable-next-line no-unused-vars
  app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept",
    );
    next();
  });

  function checkGzipAndNext(req, res, next) {
    const baseURL = `${req.protocol}://${req.headers.host}/`;
    const reqUrl = new URL(req.url, baseURL);
    const filePath = reqUrl.pathname.substring(1);

    const readStream = fs.createReadStream(filePath, { start: 0, end: 2 });
    //eslint-disable-next-line no-unused-vars
    readStream.on("error", function (err) {
      next();
    });

    readStream.on("data", function (chunk) {
      if (chunk.equals(gzipHeader)) {
        res.header("Content-Encoding", "gzip");
      }
      next();
    });
  }

  const knownTilesetFormats = [
    /\.b3dm/,
    /\.pnts/,
    /\.i3dm/,
    /\.cmpt/,
    /\.glb/,
    /\.geom/,
    /\.vctr/,
    /\.subtree/,
    /tileset.*\.json$/,
  ];
  app.get(knownTilesetFormats, checkGzipAndNext);

  // Danh sách dự án (metadata: tọa độ, zoom...) lấy từ database, để Cesium tự dựng UI/layer
  app.get("/api/projects", async (req, res) => {
    try {
      // Instance này chỉ phục vụ dự án chưa gán nhóm. DB dùng chung với instance
      // kia, nên mặc định phải là lọc — quên cấu hình thì hụt dữ liệu, không thừa.
      // SHOW_GROUP=all chỉ để debug tạm.
      const showAll = process.env.SHOW_GROUP === "all";
      const result = await pool.query(
        showAll
          ? "SELECT * FROM projects ORDER BY project_key"
          : "SELECT * FROM projects WHERE group_key IS NULL ORDER BY project_key",
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Lỗi lấy danh sách dự án từ DB:", err);
      res.status(500).end();
    }
  });

  // Lấy ảnh tile flycam từ database (Postgres) thay vì từ file trong thư mục "anh/"
  app.get("/tiles/:project/:z/:x/:y.png", async (req, res) => {
    const { project, z, x, y } = req.params;
    try {
      const result = await pool.query(
        "SELECT data FROM tiles WHERE project_key = $1 AND z = $2 AND x = $3 AND y = $4",
        [project, Number(z), Number(x), Number(y)],
      );
      if (result.rows.length === 0) {
        res.status(404).end();
        return;
      }
      res.contentType("image/png");
      res.send(result.rows[0].data);
    } catch (err) {
      console.error("Lỗi lấy tile từ DB:", err);
      res.status(500).end();
    }
  });

  // Bảng PostGIS chứa geometry thật của 6 layer Tân Bình, dùng để tra cứu khi người dùng
  // click vào lớp raster (raster chỉ để hiển thị, không mang dữ liệu — xem VectorLayerTool.js).
  // "table" lấy từ whitelist cố định bên dưới, không nội suy trực tiếp từ input người dùng.
  const VECTOR_TABLES = {
    qhCnsdd: { table: "vec_qh_cnsdd", type: "polygon" },
    longDuong: { table: "vec_long_duong", type: "line" },
    tuyenDuong: { table: "vec_tuyen_duong", type: "line" },
    timDuong: { table: "vec_tim_duong", type: "line" },
    tenDuong: { table: "vec_ten_duong", type: "point" },
    ranhB: { table: "vec_ranh_b", type: "polygon" },
  };

  app.get("/api/vector-hit", async (req, res) => {
    const { layer, lon, lat } = req.query;
    const cfg = VECTOR_TABLES[layer];
    const lonNum = Number(lon);
    const latNum = Number(lat);
    if (!cfg || !Number.isFinite(lonNum) || !Number.isFinite(latNum)) {
      res.status(400).json({ error: "Thiếu layer/lon/lat hợp lệ" });
      return;
    }

    try {
      let result;
      if (cfg.type === "polygon") {
        result = await pool.query(
          `SELECT * FROM ${cfg.table}
           WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
           LIMIT 1`,
          [lonNum, latNum],
        );
      } else {
        // Line/point: lấy đối tượng gần điểm click nhất trong bán kính 8 mét
        result = await pool.query(
          `SELECT *, ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS dist
           FROM ${cfg.table}
           WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 8)
           ORDER BY dist LIMIT 1`,
          [lonNum, latNum],
        );
      }
      if (result.rows.length === 0) {
        res.status(404).json({});
        return;
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error("Lỗi query vector-hit:", err);
      res.status(500).end();
    }
  });

  if (!production) {
    const iifeWorkersCache = new ContextCache(contexts.iifeWorkers);
    const iifeCache = createRoute(
      app,
      "Build/CesiumUnminified/Cesium.js",
      "/Build/CesiumUnminified/Cesium.js{.map}",
      contexts.iife,
      [iifeWorkersCache],
    );
    const esmCache = createRoute(
      app,
      "Build/CesiumUnminified/index.js",
      "/Build/CesiumUnminified/index.js{.map}",
      contexts.esm,
    );
    const workersCache = createRoute(
      app,
      "Build/CesiumUnminified/Workers/*",
      "/Build/CesiumUnminified/Workers/*file.js",
      contexts.workers,
    );
    const engineBundleCache = createRoute(
      app,
      "packages/engine/Build/Unminified/index.js",
      "/packages/engine/Build/Unminified/index.js{.map}",
      contexts.engine.esm,
    );
    const widgetsBundleCache = createRoute(
      app,
      "packages/widgets/Build/Unminified/index.js",
      "/packages/widgets/Build/Unminified/index.js{.map}",
      contexts.widgets.esm,
    );

    const glslWatcher = chokidar.watch("packages/engine/Source/Shaders", {
      ignored: (path, stats) => {
        return !!stats?.isFile() && !path.endsWith(".glsl");
      },
      ignoreInitial: true,
    });
    glslWatcher.on("all", async () => {
      await glslToJavaScript(false, "Build/minifyShaders.state", "engine");
      esmCache.clear();
      engineBundleCache.clear();
      iifeCache.clear();
    });

    const engineSourceWatcher = chokidar.watch(["packages/engine/Source"], {
      ignored: [
        "packages/engine/Source/Shaders",
        "packages/engine/Source/ThirdParty",
        (path, stats) => {
          return !!stats?.isFile() && !path.endsWith(".js");
        },
      ],
      ignoreInitial: true,
    });
    const widgetsSourceWatcher = chokidar.watch(["packages/widgets/Source"], {
      ignored: [
        "packages/widgets/Source/ThirdParty",
        (path, stats) => {
          return !!stats?.isFile() && !path.endsWith(".js");
        },
      ],
      ignoreInitial: true,
    });

    function clearTopLevelCaches() {
      esmCache.clear();
      iifeCache.clear();
      workersCache.clear();
      iifeWorkersCache.clear();
    }

    engineSourceWatcher.on("all", async () => {
      clearTopLevelCaches();
      engineBundleCache.clear();

      await createIndexJs("engine");
      await createCesiumJs();
    });

    widgetsSourceWatcher.on("all", async () => {
      clearTopLevelCaches();
      widgetsBundleCache.clear();

      await createIndexJs("widgets");
      await createCesiumJs();
    });

    const testWorkersCache = createRoute(
      app,
      "TestWorkers/*",
      "/Build/Specs/TestWorkers/*file",
      contexts.testWorkers,
    );
    chokidar
      .watch(["Specs/TestWorkers/*.js"], { ignoreInitial: true })
      .on("all", testWorkersCache.clear);

    const specsCache = createRoute(
      app,
      "Specs/*",
      "/Build/Specs/*file",
      contexts.specs,
    );
    const specWatcher = chokidar.watch(
      ["packages/engine/Specs", "packages/widgets/Specs", "Specs"],
      {
        ignored: [
          "packages/engine/Specs/SpecList.js",
          "packages/widgets/Specs/SpecList.js",
          "Specs/SpecList.js",
          "Specs/e2e",
          (path, stats) => {
            return !!stats?.isFile() && !path.endsWith("Spec.js");
          },
        ],
        ignoreInitial: true,
      },
    );
    specWatcher.on("all", async (event) => {
      if (event === "add" || event === "unlink") {
        await createCombinedSpecList();
      }

      specsCache.clear();
    });

    if (!production && getSandcastleConfig && buildSandcastleGallery) {
      const { configPath, root, gallery } = await getSandcastleConfig();
      const baseDirectory = path.relative(root, path.dirname(configPath));
      const galleryFiles = gallery.files.map((pattern) =>
        path.join(baseDirectory, pattern),
      );
      const galleryWatcher = chokidar.watch(galleryFiles, {
        ignoreInitial: true,
      });

      galleryWatcher.on(
        "all",
        throttle(async () => {
          const startTime = performance.now();
          try {
            await buildSandcastleGallery({ includeDevelopment: true });
            console.log(
              `Gallery built in ${formatTimeSinceInSeconds(startTime)} seconds.`,
            );
          } catch (e) {
            console.error(e);
          }
        }),
      );
    }

    // Serve any static files starting with "Build/CesiumUnminified" from the
    // development build instead. That way, previous build output is preserved
    // while the latest is being served
    app.use("/Build/CesiumUnminified", express.static("Build/CesiumDev"));
  }

  app.use(express.static(path.resolve(".")));

  const server = app.listen(
    argv.port,
    argv.public ? undefined : "localhost",
    function () {
      if (argv.public) {
        console.log(
          `Cesium development server running publicly.  Connect to http://localhost:${server.address()?.port}/`,
        );
      } else {
        console.log(
          `Cesium development server running locally.  Connect to http://localhost:${server.address()?.port}/`,
        );
      }
      console.log(
        `👉 Test Page: http://localhost:${server.address()?.port}/Apps/HelloWorld.html`,
      );
    },
  );

  server.on("error", function (/** @type {NodeJS.ErrnoException} */ e) {
    if (e.code === "EADDRINUSE") {
      console.log(
        `Error: Port ${argv.port} is already in use, select a different port.`,
      );
      console.log(`Example: node server.js --port ${argv.port + 1}`);
    } else if (e.code === "EACCES") {
      console.log(
        `Error: This process does not have permission to listen on port ${argv.port}.`,
      );
      if (argv.port < 1024) {
        console.log("Try a port number higher than 1024.");
      }
    }

    throw e;
  });

  server.on("close", function () {
    console.log("Cesium development server stopped.");
  });

  let isFirstSig = true;
  process.on("SIGINT", function () {
    if (isFirstSig) {
      console.log("\nCesium development servers shutting down.");

      if (!production) {
        contexts.esm.dispose();
        contexts.iife.dispose();
        contexts.workers.dispose();
        contexts.specs.dispose();
        contexts.testWorkers.dispose();
      }

      server.close(() => process.exit(0));

      isFirstSig = false;
    } else {
      throw new Error("Cesium development server force kill.");
    }
  });
})();
