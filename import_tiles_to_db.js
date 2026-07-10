// Nạp toàn bộ tile PNG trong 1 thư mục (định dạng {z}/{x}/{y}.png) vào bảng "tiles" của Postgres.
// Dùng: node import_tiles_to_db.js <projectKey> <duongDanFolderTile>
// Vi du: node import_tiles_to_db.js test1 anh/test1_fixed
import fs from "fs";
import path from "path";
import pool from "./db.js";

// Đếm số file .png thực tế trong thư mục tile (dùng để kiểm tra sau khi nạp).
export function countPngTiles(folderPath) {
  let total = 0;
  const zDirs = fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
  for (const zDir of zDirs) {
    const zPath = path.join(folderPath, zDir.name);
    const xDirs = fs.readdirSync(zPath, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const xDir of xDirs) {
      const xPath = path.join(zPath, xDir.name);
      total += fs.readdirSync(xPath).filter((f) => f.endsWith(".png")).length;
    }
  }
  return total;
}

// Xóa tile cũ của project (nếu có) rồi nạp lại toàn bộ ảnh PNG trong folderPath vào bảng "tiles".
// Trả về số tile đã nạp.
export async function importTilesForProject(projectKey, folderPath) {
  const zDirs = fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name));

  let total = 0;
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM tiles WHERE project_key = $1", [projectKey]);

    for (const zDir of zDirs) {
      const z = parseInt(zDir.name, 10);
      const zPath = path.join(folderPath, zDir.name);
      const xDirs = fs.readdirSync(zPath, { withFileTypes: true }).filter((d) => d.isDirectory());

      for (const xDir of xDirs) {
        const x = parseInt(xDir.name, 10);
        const xPath = path.join(zPath, xDir.name);
        const files = fs.readdirSync(xPath).filter((f) => f.endsWith(".png"));

        for (const file of files) {
          const y = parseInt(path.basename(file, ".png"), 10);
          const data = fs.readFileSync(path.join(xPath, file));
          await client.query(
            "INSERT INTO tiles (project_key, z, x, y, data) VALUES ($1, $2, $3, $4, $5)",
            [projectKey, z, x, y, data],
          );
          total++;
        }
      }
    }
  } finally {
    client.release();
  }

  return total;
}

// Chạy trực tiếp qua CLI: node import_tiles_to_db.js <projectKey> <folderPath>
const isMain = process.argv[1] && process.argv[1].endsWith("import_tiles_to_db.js");
if (isMain) {
  const [projectKey, folderPath] = process.argv.slice(2);
  if (!projectKey || !folderPath) {
    console.error("Dung: node import_tiles_to_db.js <projectKey> <duongDanFolderTile>");
    process.exit(1);
  }
  const total = await importTilesForProject(projectKey, folderPath);
  console.log(`Da nap ${total} tile cho du an "${projectKey}" vao DB.`);
  await pool.end();
}
