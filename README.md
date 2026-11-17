# Licitaciones Insight Latam — v2

Busca convocatorias de **consultoría, investigación, evaluación y estudios** en sitios web y APIs de organismos,
y muestra solo las de **Centroamérica, el Caribe, México, Estados Unidos y Brasil**.

## Qué cambió respecto a la versión anterior

| Antes | Ahora |
|---|---|
| 25 scrapers distintos; 13 devolvían 0 todos los días | Un solo motor con 8 conectores (APIs oficiales + páginas web configurables) |
| Las páginas se descartaban si el pie decía "news" o "privacy policy" | Los filtros se aplican al enlace, no a toda la página |
| El país y la fecha límite detectados se perdían | Se guardan siempre; el país se detecta en español, inglés y portugués |
| Toda Latinoamérica (y a veces África o Asia) | Solo Centroamérica, Caribe, México, EE. UU. y Brasil (editable en `src/config/regions.js`) |
| 4 botones confusos (Sí / No / Aplicar / No aplicar) | Un flujo claro: Nueva → Me interesa → Preparando → Enviada → Ganada/No ganada, o Descartada |
| Cada clic recargaba la página | Los cambios se guardan al instante, con "Deshacer" |
| No se sabía por qué algo era "Alta" | Cada oportunidad muestra las palabras clave que coincidieron |
| No se sabía qué fuentes fallaban | Estado de cada fuente, botón "Probar" y motivo exacto de cada descarte |
| Abrir una página borraba registros vencidos | Nada se borra: las vencidas se ocultan y quedan como historial |
| Nuevas fuentes: Brasil (PNCP), EE. UU. (Grants.gov, SAM.gov), Banco de Desarrollo del Caribe, UNGM corregido |

## Requisitos

- Node.js 18 o superior
- MySQL 8 o MariaDB 10.4+ (la misma base de la versión anterior sirve)
- Opcional: Google Chrome en el servidor, solo para portales hechos con JavaScript (Guatecompras, SICOP, etc.)

## Instalación nueva

```bash
npm install --omit=optional        # sin Chrome; agrega "npm install puppeteer" si lo necesitas
cp .env.example .env               # y completa los datos
npm run migrate                    # crea tablas, países, palabras clave y fuentes
npm start
```

La primera vez, `npm run migrate` crea el usuario de `DEFAULT_ADMIN_EMAIL`. Si no pusiste
`DEFAULT_ADMIN_PASSWORD`, muestra una contraseña temporal en la consola.

## Actualizar desde la versión anterior (mismo servidor y misma base de datos)

1. **Respaldar la base de datos** (phpMyAdmin → Exportar, o `mysqldump webscrip > respaldo.sql`).
2. Detener la aplicación anterior en el panel del servidor.
3. Copiar esta carpeta al servidor (por ejemplo `/www/wwwroot/WebScraper.insightlatam.com-v2`).
4. Copiar el `.env` de la versión anterior a la carpeta nueva (los nombres de variables son compatibles).
5. En la carpeta nueva:
   ```bash
   npm install --omit=optional
   npm run migrate
   ```
   La migración **no borra datos**: agrega columnas y tablas nuevas, convierte los estados anteriores
   (validada → "Me interesa", en aplicación → "Preparando", finalizada → "Enviada"), recalcula la prioridad
   con las reglas nuevas, corrige el país de algunas fuentes según su dominio (.sv, .gt, .hn…),
   desactiva fuentes que no son páginas de licitaciones (con una nota que explica por qué) y agrega las fuentes nuevas.
   Lo guardado de países fuera de la cobertura pasa a "Descartadas" (se puede recuperar).
6. En el panel del servidor, apuntar el proyecto Node a la carpeta nueva con archivo de inicio `src/server.js`
   (mismo puerto que antes) y arrancar.
7. Entrar, ir a **Fuentes** y pulsar **"Buscar en todas ahora"**. Revisar cuáles quedan en verde.

Los usuarios y contraseñas existentes siguen funcionando. Las direcciones viejas (`/dashboard`, `/opportunities`,
`/sources`…) redirigen a las nuevas.

## Uso diario

- **Oportunidades**: la bandeja. Empieza en la pestaña *Nuevas*, ordenadas por relevancia.
  - `✓ Me interesa` o `✕` descartar directamente desde la lista (con "Deshacer").
  - Clic en una fila abre el detalle: enlace, fecha límite, organismo, por qué apareció, notas del equipo e historial.
  - Atajos: `J`/`K` moverse, `Enter` abrir, `I` me interesa, `D` descartar, `X` seleccionar, `/` buscar, `Esc` cerrar.
  - Filtros por región, país, fecha límite, prioridad y fuente. **⬇ Excel** descarga lo que estás viendo.
- **Panel**: lo que hay que mirar hoy — por revisar, lo que vence esta semana, lo más relevante y qué fuentes fallan.
- **Fuentes**: activar/desactivar, **Probar** (ejecuta la fuente y explica el resultado), historial, agregar nuevas.
- **Palabras clave** (admin): puntos por palabra, exclusiones y un probador de títulos.

## Cómo se decide qué se guarda

Para cada convocatoria encontrada, en este orden:

1. Título y enlace válidos ("Leer más" se reemplaza por el título real de la página).
2. No existía ya.
3. No está vencida.
4. El título no tiene una palabra de exclusión.
5. **Relevancia ≥ `MIN_SCORE`** (25 por defecto). Las palabras en el título valen el doble; lo que aparece
   solo en la descripción suma como máximo 45 (Baja < 25 ≤ Media < 50 ≤ Alta < 100 ≤ Crítica).
6. **País dentro de la cobertura.** Si la fuente dice el país (API), se usa; si no, se busca en el título,
   luego en el texto, y por último se usa el país por defecto de la fuente.

Cada ejecución guarda cuántas se descartaron por cada motivo (Fuentes → 🕑 o la página **Actividad**).

## Fuentes incluidas

| Fuente | Tipo | Cobertura |
|---|---|---|
| Banco Mundial | API oficial | Avisos de todos los países, filtrados por región |
| BID | API | Consultorías activas |
| Naciones Unidas (UNGM) | Buscador | PNUD, UNICEF, OIM, UNOPS, OPS, ACNUR… |
| Banco de Desarrollo del Caribe | Página (tabla) | Caribe |
| PNUD, BCIE, OIT, World Vision, CARE, etc. | Página web | Las de la versión anterior |
| Brasil – PNCP | API oficial | Licitaciones con propuestas abiertas en todo Brasil |
| EE. UU. – Grants.gov | API pública | Subvenciones federales |
| EE. UU. – SAM.gov | API (requiere `SAM_API_KEY` gratuita) | Contratos federales de investigación y consultoría |
| Guatecompras, HonduCompras, COMPRASAL, SICOP, PanamaCompra, Compras Dominicana, ComprasMX | Página web con navegador | Inactivas hasta instalar Chrome (`CHROME_PATH`) |

### Agregar una fuente

En **Fuentes → Agregar fuente**, pega la URL de la página donde está el **listado** de convocatorias
(no la portada) y deja el tipo "Página web". Pulsa **Probar**. Si el sitio arma la página con JavaScript,
en *Configuración avanzada* pon `{"useBrowser": true}`.

Opciones de configuración avanzada (JSON):

```json
{
  "include": "consultor|licitaci",   // texto que debe tener el enlace (por defecto: palabras de convocatoria)
  "hrefInclude": "convocatoria",      // texto que debe tener la URL del enlace
  "exclude": "noticia|blog",          // descartar enlaces con este texto
  "followDetail": true,               // abrir cada convocatoria para leer descripción y fecha límite
  "maxItems": 40,
  "table": { "row": "table tbody tr", "title": 0, "country": 2, "deadline": 4 },
  "useBrowser": false,
  "minScore": 15                      // umbral propio para esta fuente
}
```

## Comandos

```bash
npm start                         # aplicación web + búsqueda programada
npm run migrate                   # crear/actualizar la base de datos (se puede repetir)
npm run scrape                    # buscar en todas las fuentes activas desde la terminal
npm run scrape:source -- 19       # probar una fuente por su Id
npm test                          # pruebas (las de base de datos requieren TEST_DB_DATABASE)
```

## Estructura

```
src/
  server.js                 Aplicación web
  config/                   Variables (.env), regiones y catálogo de fuentes
  db/                       Conexión y migración
  engine/
    pipeline.js             Motor: descarga → filtra → puntúa → guarda → registra
    connectors/             worldbank, idb, ungm, pncp, grantsgov, samgov, html, rss
    scheduler.js            Búsqueda cada hora (según frecuencia) y completa una vez al día
  lib/                      Fechas, países, relevancia, HTTP
  services/                 Consultas de oportunidades, fuentes, palabras, usuarios, alertas
  routes/                   Páginas y API
  views/, public/           Interfaz
tests/                      Pruebas automáticas
```

---

## Autor

**Ariel Geovanny Andino Chinchilla** — Desarrollador Full Stack

- GitHub: [@andino1234](https://github.com/andino1234)
- Repositorio: [github.com/andino1234/WebScraper](https://github.com/andino1234/WebScraper)

Proyecto diseñado y desarrollado por Ariel Geovanny Andino Chinchilla para Insight LATAM. Se publica con fines de portafolio; las credenciales, datos de clientes y archivos de usuarios se excluyeron del repositorio.
