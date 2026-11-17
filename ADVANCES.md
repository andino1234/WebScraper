# Bitácora de versiones

## v2 — Motor unificado
- Un solo motor (`src/engine/pipeline.js`) con conectores por tipo de fuente: APIs oficiales (Banco Mundial, BID, UNGM, SAM.gov, Grants.gov, PNCP) y páginas web configurables (HTML / RSS).
- Filtro geográfico: Centroamérica, Caribe, México, Estados Unidos y Brasil (`src/config/regions.js`).
- Puntaje de relevancia explicable: cada oportunidad muestra las palabras clave que coincidieron.
- Flujo de trabajo: Nueva → Me interesa → Preparando → Enviada → Ganada / No ganada, o Descartada.
- Estado por fuente, botón "Probar" y motivo de cada descarte.
- Las oportunidades vencidas se ocultan y quedan como historial.
- Alertas por Telegram y correo para oportunidades de prioridad alta.

## v1 — Base operativa
- 25 scrapers individuales por portal, CRUD de fuentes y palabras clave, importador desde Excel y reporte diario en Excel + PDF.

---

Ariel Geovanny Andino Chinchilla · https://github.com/andino1234
