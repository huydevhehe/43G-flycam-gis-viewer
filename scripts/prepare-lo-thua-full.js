// Chuẩn hoá bộ "Lô thửa FULL" (GEOJSON_229_LATEST_2025_GAPS_RECHECKED — ranh giới đã rà lại,
// phủ kín khu vực, không còn lỗ hổng) để import PostGIS. Khác bộ "Lô thửa" hiện có (13.265
// thửa, 84% có tên chủ): bộ này KHÔNG có tên chủ/địa chỉ (0%), chỉ có ranh + diện tích — đổi
// lấy độ phủ đầy đủ. Xem báo cáo so sánh trong hội thoại, sếp đã chọn lên cả 2 bản song song.
// Dùng: node scripts/prepare-lo-thua-full.js <file_input.geojson> <file_output.geojson>
import fs from "fs";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  console.error("Dung: node scripts/prepare-lo-thua-full.js <file_input.geojson> <file_output.geojson>");
  process.exit(1);
}

function epChuoi(v) {
  return v == null ? null : String(v);
}

function main() {
  const g = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const ketQua = [];
  let idMoi = 1;
  let boQua = 0;

  for (const f of g.features) {
    if (!f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) {
      boQua++;
      continue;
    }
    const p = f.properties || {};
    ketQua.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: idMoi++,
        so_to: epChuoi(p.page_num),
        so_thua: epChuoi(p.plot_num),
        dien_tich_m2: p.area != null ? Number(p.area) : null,
        // Shape_Length trong file goc la don vi DO (kinh/vi do), khong phai met — khong the
        // dung truc tiep lam "chu vi met". Bo qua, khong bia so sai; chi giu dien tich thuc.
      },
    });
  }

  fs.writeFileSync(outputPath, JSON.stringify({ type: "FeatureCollection", features: ketQua }));
  console.log(`Da xu ly ${ketQua.length} thua (bo qua ${boQua} feature loi geometry).`);
  console.log(`Ghi ra: ${outputPath}`);
}

main();
