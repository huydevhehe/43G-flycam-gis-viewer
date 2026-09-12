#!/bin/bash
# Import 1 file GeoJSON vao PostGIS thanh 1 bang vec_* — dung chung cho cac lop du lieu moi,
# thay vi viet rieng 1 script cho tung bang (xem scripts/import-lo-thua-moi.sh cho ban rieng
# cua bo Lo thua dau tien, van giu nguyen, khong lien quan script nay).
# Dung: bash scripts/import-vector-table.sh <ten_bang_postgis> <duong_dan_file.geojson>
# Vi du: bash scripts/import-vector-table.sh vec_lo_thua_full lo_thua_full.geojson
# Chay tu thu muc goc project tren server (noi co file .env).
set -e

TABLE="$1"
INPUT="$2"

if [ -z "$TABLE" ] || [ -z "$INPUT" ]; then
  echo "Dung: bash scripts/import-vector-table.sh <ten_bang_postgis> <duong_dan_file.geojson>"
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
DB_PASSWORD="${DB_PASSWORD%$'\r'}"
export PGPASSWORD="$DB_PASSWORD"

PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
PGCONN="PG:host=$DB_HOST port=$DB_PORT user=$DB_USER dbname=$DB_NAME password=$DB_PASSWORD"
OGR_PREFIX=""

for cmd in psql ogr2ogr; do
  command -v "$cmd" >/dev/null || { echo "Thieu lenh '$cmd'. Cai postgresql-client + gdal-bin truoc."; exit 1; }
done

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

echo "[1/3] Xoa bang cu '$TABLE' neu co (de chay lai nhieu lan khong bi loi trung ten)..."
$PSQL -q -c "DROP TABLE IF EXISTS $TABLE"

echo "[2/3] Import '$INPUT' vao bang '$TABLE'..."
$OGR_PREFIX ogr2ogr -f "PostgreSQL" "$PGCONN" "$INPUT" \
  -nln "$TABLE" -lco GEOMETRY_NAME=geom -lco FID=id -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326

echo "[3/3] Kiem tra ket qua..."
$PSQL -tAc "SELECT count(*) FROM $TABLE" | while read -r n; do echo "  -> Da import $n dong vao bang $TABLE."; done
