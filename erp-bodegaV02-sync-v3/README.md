# ERP de Insumos para Bodega

## Sincronización multiusuario centralizada en D1

Esta entrega reemplaza la estrategia histórica donde cada navegador podía terminar consultando Google Sheets por separado. Está preparada para uso simultáneo desde muchos dispositivos sin multiplicar las lecturas a Google.

- Los navegadores consultan la programación compartida guardada en **Cloudflare D1**.
- La actualización automática sigue ejecutándose cada **30 segundos** mientras la pestaña está visible.
- La llamada automática inicia una actualización en segundo plano y vuelve a consultar solamente D1 8 segundos después, para reflejar la nueva lectura sin hacer esperar a cada usuario por Google.
- Las tablas `program_sync_state` y `program_sync_lock` implementan un **lease/lock distribuido**: como máximo un Worker puede leer Google Sheets durante un ciclo, incluso si hay muchas instancias de Cloudflare y muchos usuarios conectados.
- Se eliminaron `cachedProgram` y `pendingProgram` como mecanismo de coordinación, porque la memoria de un Worker no es compartida con otros Workers.
- Antes de consultar Google, el Worker vuelve a revisar el cache de D1 para evitar una segunda lectura causada por una condición de carrera.
- Una respuesta vieja de Google no puede sobrescribir una lectura más nueva ya guardada en D1.
- Google tiene reintentos acotados para errores transitorios; si falla, se conserva la **última lectura válida**.
- **Actualizar ahora** sigue permitiendo solicitar una lectura nueva, pero también respeta el lock global para que varios clics simultáneos no generen una tormenta de solicitudes.
- El valor predeterminado recomendado es **30 segundos de sincronización y 30 segundos de cache compartido**.

### Flujo multiusuario

```text
100 navegadores
      |
      v
/api/program
      |
      v
Cloudflare D1  <---- todos leen la misma programación
      |
      +---- lease distribuido ----> 1 Worker líder
                                      |
                                      v
                                Google Sheets
                                      |
                                      v
                              actualiza D1 una vez
```

El diseño evita que la cantidad de consultas a Google crezca con la cantidad de usuarios. La capacidad final depende de los límites y la configuración del despliegue de Cloudflare, por lo que una cifra exacta de concurrencia debe confirmarse con una prueba de carga en el entorno publicado.

## Necesidad total ajustada por traslados (v37)

- **Cantidad ya trasladada a la línea** modifica directamente la necesidad total pendiente.
- Desde el motor de cálculo, `total` pasa a representar `necesidad original - trasladado`; así ninguna pantalla puede volver a mostrar la necesidad original como si siguiera pendiente.
- El faltante se calcula solamente como `necesidad total ajustada - stock`, con mínimo cero.
- El traslado no se suma al stock y no vuelve a restarse en el faltante.
- Ejemplo: necesidad original `1.039.560`, traslado `100.000` → necesidad total `939.560`; con stock `522.662` → faltante `416.898`.
- La misma regla se aplica al detalle semanal, Excel y PDF.

## Traslados descontados de la necesidad y PDF (v36)

- **Cantidad ya trasladada a la línea** se resta una sola vez de la necesidad original.
- La pantalla muestra como **Necesidad total** el saldo pendiente: `necesidad original - trasladado`.
- El faltante se calcula después: `necesidad pendiente - stock en depósitos`, con mínimo cero.
- El descuento se distribuye cronológicamente por semana para no repetirlo ni duplicarlo.
- El reporte Excel usa la misma lógica e identifica necesidad original, traslado, necesidad pendiente, stock y faltante.
- Se mantiene el botón **Imprimir / guardar PDF** con el diseño operativo anterior y los cálculos corregidos.
- Ejemplo validado: `817.560 - 100.000 = 717.560`; con stock `522.662`, el faltante es `194.898`.

## Exportación Excel de faltantes (v34)

- El botón **Descargar Excel** genera un archivo `.xlsx` con el mismo análisis operativo de la pantalla.
- Incluye una hoja **Resumen**, un consolidado de **Faltantes**, el **Detalle semanal** y el **Stock por código**.
- Agrega una hoja independiente por tipo de insumo: cápsulas/tapas, botellas, tapones/corchos, cajas, etiquetas, embalaje auxiliar y otros.
- Conserva la necesidad total, el stock por depósito, el material trasladado a línea, el faltante, los códigos compatibles y la cobertura de cada semana.
- Los códigos compartidos se exportan como un único grupo y también quedan desglosados por código y depósito.

## Sincronización directa visible cada 30 segundos (v32)

- Cada ciclo automático consulta directamente Google Sheets con `fresh=1`; ya no
  depende de una tarea en segundo plano que podía no terminar en Cloudflare.
- El ícono de **Actualizar ahora** gira también durante la sincronización
  automática y deja de girar cuando llega la respuesta o vence el tiempo máximo.
- La tarjeta **Última lectura** cambia solamente al recibir una lectura nueva y
  válida de Google Sheets.
- El ERP actualiza inmediatamente al volver a la pestaña, recuperar el foco o
  restablecerse la conexión a Internet.
- Una lectura automática puede esperar hasta 25 segundos. La protección existente
  evita que se superpongan dos sincronizaciones.

## Sincronización automática con watchdog (v29)

- Cada ciclo espera una lectura real y nueva de Google Sheets; ya no se limita a
  mostrar inmediatamente la copia anterior mientras la actualización queda en
  segundo plano.
- El próximo ciclo se agenda al finalizar el anterior, evitando solicitudes
  superpuestas.
- Un watchdog revisa el estado cada 10 segundos. Si la última lectura supera el
  intervalo configurado más 15 segundos, con un mínimo de 60 segundos, fuerza
  un nuevo intento.
- Al regresar a la pestaña, recuperar el foco o restablecerse Internet, el ERP
  actualiza inmediatamente cuando la lectura está atrasada.
- Una lectura puede esperar hasta 35 segundos antes de cancelarse, porque Google
  puede necesitar varias consultas consecutivas para devolver valores y tachados.
- La interfaz deja de mostrar “Sincronizado en vivo” cuando la lectura está
  vencida y cambia a “Sincronización atrasada · reintentando”.

## Sincronización sin bloqueos (v41)

- Las consultas a Google Sheets y Cloudflare tienen un tiempo máximo.
- Si una respuesta demora demasiado, el indicador `Actualizando…` se libera,
  se conservan la programación y los cálculos de la última lectura válida y el
  sistema vuelve a intentarlo en el siguiente ciclo automático.
- Los errores temporales `429`, `503` y `504` tienen un único reintento
  controlado; nunca se genera un bucle de solicitudes.
- La lectura interna de Google también se cancela si queda pendiente, evitando
  que una sincronización trabada bloquee las siguientes.

## Consultas de insumos por código (v40)

- El asistente acepta un código escrito directamente, por ejemplo `20383`.
- Busca el insumo en fichas técnicas, consumo calculado y stock.
- Informa descripción, categoría, necesidad del programa, stock total,
  distribución por depósito, faltante o saldo, semanas y productos relacionados.
- Si el código no existe, lo informa claramente en lugar de devolver una
  respuesta general.
- Las consultas por código se resuelven con datos verificables del ERP incluso
  sin una clave de IA. La IA opcional se mantiene para redactar respuestas
  generales más naturales.

## Actualización completa y asistente operativo (v39)

- El botón de Consumos y Faltantes ahora se llama **Actualizar y
  recalcular**. Primero consulta nuevamente Google Sheets, fichas técnicas y
  stock; después compara la necesidad contra las existencias.
- Un panel visible informa la etapa en curso, la hora del último cálculo y el
  resumen usado: operaciones, insumos, faltantes y registros de stock.
- El asistente reconoce consultas naturales con o sin tildes, por ejemplo
  `¿está andando la sincronización?`, `¿qué faltantes tengo?` y
  `¿qué tapón me va a faltar?`.
- Las respuestas de faltantes se construyen con el último cálculo real del ERP,
  sin inventar códigos ni cantidades. La IA externa continúa siendo opcional.

## Mejora de estabilidad en Cloudflare (v38)

Las pantallas **Consumos** y **Faltantes** calculan sus resultados
en el navegador usando la programación, las fichas técnicas y el stock que ya
fueron sincronizados. Esto elimina consultas repetidas y pesadas a
`/api/requirements`, evita errores 503 por límite de CPU y conserva la misma
lógica de operaciones realizadas, stock por depósito y faltantes.

## Mejoras de esta entrega

- Sincronización inmediata al iniciar sesión, actualización automática cada 30 segundos y botón manual.
- Una sola lectura de Google Sheets compartida entre Programación y el motor de cálculo, con reintento controlado para evitar respuestas 503 y Error 1102.
- El último programa y el último cálculo correcto permanecen visibles si Google o Cloudflare demoran.
- Las filas con texto tachado en cualquier celda entre A y Z se muestran como `REALIZADO` y quedan excluidas de Consumos y Faltantes.
- El módulo visible `BOM` pasa a llamarse `Ficha técnica`; las rutas y tablas internas se conservan para no perder información.
- Asistente general: responde sobre el ERP y, con la API de OpenAI configurada, también consultas de cualquier tema. Mantiene memoria corta de la conversación y puede usar búsqueda web para preguntas de actualidad.

### IA opcional para el asistente

La aplicación funciona sin una clave de OpenAI para las consultas operativas del ERP. Para que el chatbot responda también preguntas generales de cualquier tema, configurá estos secretos/variables en Cloudflare:

- `OPENAI_API_KEY`: secreto de la API de OpenAI.
- `OPENAI_MODEL`: opcional; el valor sugerido es `gpt-5.2`. Si el valor configurado no está disponible para la cuenta, el endpoint prueba automáticamente modelos compatibles de respaldo.

Nunca coloques la clave real en `.env.example` ni la subas a Git.

El chatbot envía al modelo el estado actual del ERP solo como contexto operativo. Si la pregunta no está relacionada con el ERP, la IA no queda restringida a ese contexto y responde como asistente general. Para preguntas recientes o de actualidad tiene habilitada la herramienta de búsqueda web de la Responses API.

## Mejoras de la versión 32

- El aviso de cambios abre Programación y filtra las filas agregadas o modificadas.
- La configuración operativa es editable únicamente por administradores y se guarda en Cloudflare D1.
- Permite configurar el ID del Sheet, los intervalos de sincronización y caché, y los depósitos incluidos.
- La caché de programación es compartida en D1 para evitar reprocesamientos entre navegadores y reducir el riesgo del Error 1102.
- La configuración sigue siendo editable por el administrador. Esta entrega migra el valor anterior a 30 segundos de sincronización y 15 segundos de caché.
- Las credenciales privadas de Google permanecen protegidas como secretos de Cloudflare.

## Mejoras de la versión 28

- Programación conectada a Google Sheets sin caché, actualización automática cada 30 segundos con la pestaña visible y botón manual.
- Importación de hasta 20.000 insumos en lotes D1, reemplazo de la fotografía anterior y verificación de la cantidad realmente guardada.
- Recálculo de faltantes después de confirmar la importación completa.
- Reporte general y reporte Excel individual por insumo, nombrado con la descripción del material.
- Administración de usuarios: altas, bajas, perfiles, permisos, bloqueo, restablecimiento de contraseña y estado de credenciales.
- Cambio de contraseña propio desde el menú de perfil. Las contraseñas son hashes irreversibles y nunca se muestran en texto plano.
- Asistente con respuestas conversacionales y búsqueda por código o nombre.
- Indicador de Fraccionamiento calculado según la cantidad real de pestañas/semanas detectadas en Google Sheets.

## Mejoras de la versión 29

- Stock total con desglose por depósitos `2`, `C18`, `R18` y `2OB`.
- Nueva tabla D1 `stock_depot_items`, creada automáticamente al iniciar la aplicación.
- Depósitos visibles en Stock y Faltantes.
- Lecturas de Google Sheets reutilizadas durante 15 segundos para evitar picos y errores 503.
- Sincronizaciones simultáneas consolidadas en una única descarga; el botón manual fuerza una lectura nueva.
- Respuestas de error de API controladas para evitar mensajes `Unexpected token '<'`.
- Fuentes locales del sistema para eliminar los 404 de archivos Geist.

## Mejoras de la versión 30

- Una sola fila por código de insumo dentro de cada archivo; los productos consumidores quedan consolidados en una celda.

## Mejoras de la versión 31

- Administración conserva intacta la gestión de usuarios y agrega pestañas informativas de Configuración y Diagnóstico.
- Diagnóstico muestra conexión, última lectura, semanas, operaciones, stock y estado del motor de cálculo, con botón para probar la conexión.
- El depósito `13` se identifica como Producción y se suma al stock disponible para calcular Faltantes.
- Los depósitos permanecen desglosados en pantalla y en Excel: `13 (Producción)`, `C18 (Calidad)`, `2 (Depósito 2)`, `R18` y `2OB`.
- Prueba de control: necesidad 300.000 menos 230.000 disponibles entre depósitos produce un faltante de 70.000.

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout and then validates the Sites artifact. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build and validate the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build, validate, and verify the rendered development-preview metadata
- `npm run validate:artifact`: recheck an existing artifact's manifest and ESM `default.fetch` export
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build and validation commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

## Ajuste v31: sincronización estable

- Se restauró el ciclo de sincronización probado cada 30 segundos.
- La actualización automática usa el endpoint en segundo plano y luego verifica la lectura almacenada.
- Se eliminó el watchdog de lecturas forzadas que podía superponer trabajo en el servidor.
- Se conserva la optimización de `/api/stock` mediante una única consulta JOIN y agrupación lineal.
- El módulo Compras continúa eliminado y las operaciones tachadas siguen excluyéndose de Faltantes.

## Faltantes operativos por semana

La pantalla **Faltantes** permite:

- informar cantidades ya trasladadas a línea; se guardan en D1 y reducen el faltante;
- agrupar los insumos por familia (botellas, cápsulas/tapas, tapones/corchos, cajas, etiquetas y otros);
- distribuir la disponibilidad cronológicamente para mostrar la necesidad y el faltante de cada semana;
- sumar el stock de códigos compatibles o sustitutos, mostrando debajo el detalle de cada código y depósito;
- descargar un reporte HTML con el mismo formato visual o imprimirlo/guardarlo como PDF.

Los códigos alternativos deben estar cargados como sustitutos en la ficha técnica o aparecer juntos en el código compuesto (por ejemplo `30354-30354A`). En fichas provisionales, los códigos distintos del mismo tipo de insumo para un producto se convierten automáticamente en sustitutos.

## Exportación Excel detallada de faltantes (v35)

La descarga de Faltantes abre directamente la hoja **Reporte completo**, con una fila por insumo y semana. Incluye código o grupo, descripción, códigos compatibles, productos programados, necesidad semanal y total, cobertura, faltante semanal y total, stock combinado, stock por código, stock por depósito y cantidad trasladada a línea. Las hojas Resumen, Faltantes, Detalle semanal, Stock por código y las hojas por tipo de insumo se conservan como apoyo.


## Impresión PDF sin pestaña en blanco (v38)

- El reporte de faltantes se prepara dentro de un documento de impresión embebido y temporal.
- El botón **Imprimir / guardar PDF** abre directamente el diálogo de impresión del navegador.
- Ya no utiliza `window.open()` ni deja una pestaña `about:blank`.
- Al finalizar o cancelar la impresión, el documento temporal se elimina automáticamente.

### Sincronización multiusuario v2

La programación de Google Sheets se comparte mediante D1. Los ciclos automáticos son no bloqueantes: los usuarios reciben la última lectura de D1 inmediatamente y solo un Worker puede revalidar Google por vez. El primer ingreso después de un despliegue con D1 vacío espera una lectura útil para evitar mostrar cero operaciones durante varios ciclos.
