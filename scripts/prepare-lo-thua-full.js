// Chuan hoa bo "Lo thua FULL" (ranh gioi da ra lai/lap lo hong, khong co ten chu/dia chi) de
// import PostGIS. Dung chung cho ca 2 nguon sep gui: GEOJSON_229_LATEST_2025_GAPS_RECHECKED
// (30.438 thua) va GEOJSON_229_LATEST_2025_FULL_FILL_6_FIELDS_UTF8 (37.355 thua, ban thay the).
// Ca 2 deu chi co 6 cot: OBJECTID/page_num/plot_num/area/Shape_Length/Shape_Area.
//
// Shape_Length co the la don vi DO (kinh/vi do, ban GAPS_RECHECKED) hoac MET that (ban
// FULL_FILL) tuy nguon — script TU DO bang cach so Shape_Length voi can(dien_tich): thua dat
// tu nhien co ty le chu_vi/can(dien_tich) khoang 3.5-8; neu ra ngoai khoang do (VD do do la
// don vi do, ty le se cuc nho ~0.001) thi COI LA KHONG DUNG DUOC, bo qua cot chu vi cho an
// toan thay vi bia so sai.
// Dung: node scripts/prepare-lo-thua-full.js <file_input.geojson> <file_output.geojson>
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

function donViChuViHopLe(features) {
  const mau = features
    .slice(0, 1000)
    .filter((f) => f.properties?.area > 1 && f.properties?.Shape_Length > 0);
  if (mau.length < 20) return false;
  const tySo = mau.map((f) => f.properties.Shape_Length / Math.sqrt(f.properties.area));
  const trungBinh = tySo.reduce((a, b) => a + b, 0) / tySo.length;
  return trungBinh >= 3.5 && trungBinh <= 8;
}

function main() {
  const g = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const coChuVi = donViChuViHopLe(g.features);
  console.log(
    coChuVi
      ? "Shape_Length dung don vi met (ty le chu_vi/can(dien_tich) hop ly) -> giu lam Chu vi."
      : "Shape_Length KHONG hop ly lam met (co the la don vi do) -> bo qua cot Chu vi.",
  );

  const ketQua = [];
  let idMoi = 1;
  let boQua = 0;

  for (const f of g.features) {
    if (!f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) {
      boQua++;
      continue;
    }
    const p = f.properties || {};
    const props = {
      id: idMoi++,
      so_to: epChuoi(p.page_num),
      so_thua: epChuoi(p.plot_num),
      dien_tich_m2: p.area != null ? Number(p.area) : null,
    };
    if (coChuVi && p.Shape_Length != null) props.chu_vi_m = Number(p.Shape_Length);
    ketQua.push({ type: "Feature", geometry: f.geometry, properties: props });
  }

  fs.writeFileSync(outputPath, JSON.stringify({ type: "FeatureCollection", features: ketQua }));
  console.log(`Da xu ly ${ketQua.length} thua (bo qua ${boQua} feature loi geometry).`);
  console.log(`Ghi ra: ${outputPath}`);
}

main();
