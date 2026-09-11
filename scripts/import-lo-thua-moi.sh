#!/bin/bash
# Import bo Lo thua MOI (229 to ban do, da gop/sua font bang prepare-lo-thua-moi.js) vao PostGIS,
# thay the bang cu "vec_lo_thua" tren giao dien (bang cu KHONG bi dung/xoa).
# Dung: bash scripts/import-lo-thua-moi.sh <duong_dan_file_lo_thua_moi.geojson>
# Chay tu thu muc goc project tren server (noi co file .env).
set -e

TABLE="vec_lo_thua_moi"
INPUT="$1"

if [ -z "$INPUT" ]; then
  echo "Dung: bash scripts/import-lo-thua-moi.sh <duong_dan_file.geojson>"
  echo "File nay tao o may, chay scripts/prepare-lo-thua-moi.js truoc, roi upload len server."
  exit 1
fi
if [ ! -f "$INPUT" ]; then
  echo "Khong thay file: $INPUT"
  exit 1
fi

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-cesium_gis}"
# .env soan tren Windows hay dinh ky tu xuong dong \r o cuoi dong -> mat khau sai vo hinh.
DB_PASSWORD="${DB_PASSWORD%$'\r'}"
export PGPASSWORD="$DB_PASSWORD"

PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
PGCONN="PG:host=$DB_HOST port=$DB_PORT user=$DB_USER dbname=$DB_NAME password=$DB_PASSWORD"
OGR_PREFIX=""

for cmd in psql ogr2ogr; do
  command -v "$cmd" >/dev/null || { echo "Thieu lenh '$cmd'. Cai postgresql-client + gdal-bin truoc."; exit 1; }
done

# Thu ket noi bang mat khau tu .env truoc; sai thi chuyen sang muon user he thong "postgres"
# (peer auth qua socket) - can dang chay bang root.
if ! $PSQL -tAc "SELECT 1" >/dev/null 2>&1; then
  if [ "$(id -u)" = "0" ] && sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT 1" >/dev/null 2>&1; then
    echo "Mat khau trong .env khong dung -> chuyen sang chay bang user he thong 'postgres'."
    PSQL="sudo -u postgres psql -d $DB_NAME"
    PGCONN="PG:dbname=$DB_NAME"
    OGR_PREFIX="sudo -u postgres"
  else
    echo "Khong ket noi duoc database $DB_NAME. Kiem tra lai DB_PASSWORD trong .env."
    exit 1
  fi
fi

echo "[1/3] Xoa bang cu '$TABLE' neu co (de chay lai script nay nhieu lan khong bi loi trung ten)..."
$PSQL -q -c "DROP TABLE IF EXISTS $TABLE"

echo "[2/3] Import '$INPUT' vao bang '$TABLE'..."
# -t_srs EPSG:4326: file input da la WGS84 (kinh/vi do), ep lai cho chac chan khop quy uoc
#   cac bang vec_* khac trong DB (rasterize-prep.js gia dinh cot geom la EPSG:4326).
# -lco GEOMETRY_NAME=geom: cac script hien co (rasterize-prep.js) doc cung ten cot "geom".
# -nlt PROMOTE_TO_MULTI: du lieu goc lan lon Polygon/MultiPolygon, gom ve 1 kieu cho dong nhat.
$OGR_PREFIX ogr2ogr -f "PostgreSQL" "$PGCONN" "$INPUT" \
  -nln "$TABLE" -lco GEOMETRY_NAME=geom -lco FID=id -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326

echo "[3/3] Kiem tra ket qua..."
$PSQL -tAc "SELECT count(*) FROM $TABLE" | while read -r n; do echo "  -> Da import $n thua vao bang $TABLE."; done

echo ""
echo "XONG buoc import DB. Buoc tiep theo: raster hoa thanh anh tile:"
echo "  bash scripts/rasterize-layer.sh loThuaMoi 18"
echo "Sau do deploy code (bash deploy.sh) de web hien lop 'Lo thua' moi."
