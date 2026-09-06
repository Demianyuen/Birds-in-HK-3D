# Wang Fuk building footprint source

Retrieved on local date 2026-09-06, Asia/Hong_Kong.

Official service:
`https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637211194312_35158/MapServer/0`

Layer name: Building. Geometry type: esriGeometryPolygon.
Query: HK1980 envelope 836030,834080,836250,834240 (inSR=2326),
spatial relation intersects, outSR=4326, f=geojson, returnGeometry=true.
Fields: BuildingID, BuildingNameEN, BuildingNameTC, BaseHeight, TopHeight,
Storeys, BuildingCSUID, DateStamp.

Downloaded reference:
`assets/reference/wang-fuk-building-footprints.geojson`
SHA-256: `FCFA48023F0E89D0F160C418519DB0BB79CA8AE5B2F6407D6F16066508B62B4A`

The envelope returned 12 features: eight named residential blocks and four
neighbouring school/carpark/service buildings. Only the eight exact
BuildingCSUID matches to the ALS GeoAddress identifiers are selected.
Chinese names are checked independently; `宏仁閣(A座)` matches `宏仁閣`.

## Scope and limitations

- The source now supplies named footprints and base/top height attributes.
- All eight Storeys values are null: do not invent floor counts.
- Height datum and original-as-built equivalence need additional documentation;
  top minus base is only a source-derived vertical span.
- DateStamp is a data attribute, not the historical appearance date.
- Layer copyrightText was blank; that is not a declaration of public-domain status.
  Keep this as local reference pending full reuse/attribution review before packaging it publicly.
- The source does not establish 1983 finishes, doors, windows or landscape.
- CSDI tiled meshes still need spatial comparison against these named polygons.
  Do not replace an entire district tile or infer that a mesh equals one building.

`extractWangFukFootprints` validates exact identity, names, finite heights,
closed WGS84 polygon rings and expected local bounds. Missing/duplicate identity
or invalid geometry fails rather than generating guessed building geometry.
