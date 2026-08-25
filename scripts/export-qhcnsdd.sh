#!/bin/bash
# Xuat rieng lop "Quy hoach su dung dat" ra file de gui di noi khac.
# Xuat DAY DU ca 2 dang, ai nhan cung dung duoc:
#   - Dang GIS (shapefile + geojson): mo bang QGIS/MapInfo, xem/bien tap binh thuong.
#   - Dang pg_dump (geometry + anh tile): dung de dung lai app y het tren server.
# Dung: bash scripts/export-qhcnsdd.sh [thu_muc_xuat]
# Chay tu thu muc goc project tren server (noi co file .env).
set -e

TABLE="vec_qh_cnsdd"
TILE_KEY="vector_qhcnsdd"
TMP_TABLE="tiles_qhcnsdd_export"
OUT_DIR="${1:-export_qhcnsdd_$(date +%Y%m%d)}"

# Lay thong tin ket noi tu .env (cung nguon voi db.js), thieu thi dung mac dinh nhu db.js
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-cesium_gis}"
# .env soan tren Windows hay dinh ky tu xuong dong \r o cuoi dong -> mat khau sai mot cach
# vo hinh (psql bao "password authentication failed" du mat khau go dung). Cat bo cho chac.
DB_PASSWORD="${DB_PASSWORD%$'\r'}"
export PGPASSWORD="$DB_PASSWORD"

PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
PGDUMP="pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
PGCONN="PG:host=$DB_HOST port=$DB_PORT user=$DB_USER dbname=$DB_NAME password=$DB_PASSWORD"
OGR_PREFIX=""

for cmd in psql pg_dump; do
  command -v "$cmd" >/dev/null || { echo "Thieu lenh '$cmd'. Cai postgresql-client truoc."; exit 1; }
done

# Thu ket noi truoc khi lam gi. Neu mat khau trong .env khong dung, quay sang muon user he
# thong "postgres" (peer auth) — cach nay khong can mat khau, mien la dang chay bang root.
if ! $PSQL -tAc "SELECT 1" >/dev/null 2>&1; then
  if [ "$(id -u)" = "0" ] && sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT 1" >/dev/null 2>&1; then
    echo "Mat khau trong .env khong dung -> chuyen sang chay bang user he thong 'postgres'."
    PSQL="sudo -u postgres psql -d $DB_NAME"
    PGCONN="PG:dbname=$DB_NAME"
    PGDUMP="sudo -u postgres pg_dump -d $DB_NAME"
    OGR_PREFIX="sudo -u postgres"
  else
    echo "Khong ket noi duoc database $DB_NAME. Kiem tra lai DB_PASSWORD trong .env."
    exit 1
  fi
fi

mkdir -p "$OUT_DIR"

echo "[1/5] Kiem tra du lieu..."
$PSQL -tAc "SELECT count(*) FROM $TABLE" | while read -r n; do echo "  -> $TABLE: $n doi tuong"; done
$PSQL -tAc "SELECT count(*), coalesce(pg_size_pretty(sum(length(data))::bigint),'0') FROM tiles WHERE project_key='$TILE_KEY'" \
  | awk -F'|' '{print "  -> anh tile: "$1" tile, "$2}'

echo "[2/5] Xuat geometry (pg_dump)..."
# Ghi ra man hinh roi tu chuyen huong vao file (khong dung -f): o che do muon user postgres,
# chinh user do se khong co quyen ghi vao thu muc cua minh, con chuyen huong thi shell lo.
$PGDUMP -Fc -t "$TABLE" > "$OUT_DIR/qh_cnsdd_vector.dump"

echo "[3/5] Xuat anh tile (pg_dump qua bang tam)..."
# pg_dump khong loc duoc theo dong, phai tao bang tam chi chua tile cua lop nay.
# Bang tam bi xoa o buoc 5 ke ca khi script chet giua chung (xem trap ben duoi).
trap '$PSQL -q -c "DROP TABLE IF EXISTS $TMP_TABLE" >/dev/null 2>&1 || true' EXIT
$PSQL -q -c "DROP TABLE IF EXISTS $TMP_TABLE"
$PSQL -q -c "CREATE TABLE $TMP_TABLE AS SELECT * FROM tiles WHERE project_key='$TILE_KEY'"
$PGDUMP -Fc -t "$TMP_TABLE" > "$OUT_DIR/qh_cnsdd_tiles.dump"

echo "[4/5] Xuat ban GIS (shapefile + geojson)..."
if command -v ogr2ogr >/dev/null; then
  mkdir -p "$OUT_DIR/qh_cnsdd_shp"
  if [ -n "$OGR_PREFIX" ]; then
    # ogr2ogr chay bang user postgres nen phai mo quyen ghi tam vao thu muc xuat,
    # dong lai ngay sau khi xong (khong de thu muc mo quyen nam lai tren server).
    chmod 777 "$OUT_DIR" "$OUT_DIR/qh_cnsdd_shp"
  fi
  $OGR_PREFIX ogr2ogr -f GeoJSON "$OUT_DIR/qh_cnsdd.geojson" "$PGCONN" "$TABLE"
  # Shapefile cat ten cot con 10 ky tu va tach thanh nhieu file -> gom vao thu muc rieng.
  # ENCODING=UTF-8 bat buoc phai co: mac dinh shapefile ghi bang ISO-8859-1 (Tay Au), chu
  # tieng Viet co dau nhu "Dat kho bai" se bi hong khi mo bang MapInfo/ArcGIS.
  $OGR_PREFIX ogr2ogr -f "ESRI Shapefile" -lco ENCODING=UTF-8 "$OUT_DIR/qh_cnsdd_shp" "$PGCONN" "$TABLE"
  if [ -n "$OGR_PREFIX" ]; then
    chmod 755 "$OUT_DIR" "$OUT_DIR/qh_cnsdd_shp"
    chown -R "$(id -u):$(id -g)" "$OUT_DIR" 2>/dev/null || true
  fi
  echo "  -> Da xuat geojson + shapefile."
else
  echo "  -> BO QUA: khong co ogr2ogr (cai gdal-bin de xuat shapefile/geojson)."
  echo "     Hai file .dump o tren van day du, chi thieu ban cho QGIS/MapInfo."
fi

echo "[5/5] Ghi huong dan va nen lai..."
cat > "$OUT_DIR/DOC-HUONG-DAN.txt" <<EOF
LOP QUY HOACH SU DUNG DAT - xuat ngay $(date +%d/%m/%Y) tu database $DB_NAME

CO GI TRONG DAY
  qh_cnsdd.geojson      Du lieu ban do, mo thang bang QGIS (keo tha vao la xong).
  qh_cnsdd_shp/         Cung du lieu do, dang shapefile cho MapInfo/ArcGIS.
                        Luu y: shapefile cat ten cot con 10 ky tu, xem geojson de biet ten day du.
  qh_cnsdd_vector.dump  Ban sao bang PostGIS $TABLE (dung khi dung lai app).
  qh_cnsdd_tiles.dump   Anh tile da ve san cua lop nay (project_key = $TILE_KEY).

MO DE XEM: chi can qh_cnsdd.geojson hoac thu muc qh_cnsdd_shp.

DUNG LAI TREN MAY KHAC (can PostgreSQL + PostGIS):
  createdb -U postgres cesium_gis
  psql -U postgres -d cesium_gis -c "CREATE EXTENSION postgis;"
  pg_restore -U postgres -d cesium_gis qh_cnsdd_vector.dump
  pg_restore -U postgres -d cesium_gis qh_cnsdd_tiles.dump
  psql -U postgres -d cesium_gis -c "INSERT INTO tiles SELECT * FROM $TMP_TABLE; DROP TABLE $TMP_TABLE;"
  (Neu bang tiles chua ton tai, tao truoc theo cau truc trong import_tiles_to_db.js)

He toa do: EPSG:4326 (WGS84 kinh do/vi do).
EOF

if command -v tar >/dev/null; then
  tar -czf "$OUT_DIR.tar.gz" "$OUT_DIR"
  echo "  -> Da nen: $OUT_DIR.tar.gz ($(du -h "$OUT_DIR.tar.gz" | cut -f1))"
fi

echo ""
echo "XONG. Thu muc: $OUT_DIR"
ls -lh "$OUT_DIR"
