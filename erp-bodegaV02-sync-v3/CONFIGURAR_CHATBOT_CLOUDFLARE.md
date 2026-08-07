# Activar el chatbot general en Cloudflare

El ERP puede responder consultas operativas sin IA externa, pero para responder preguntas de cualquier tema necesita una clave de la API de OpenAI.

## Variables necesarias

En la configuración del Worker agregá:

- `OPENAI_API_KEY` como secreto.
- `OPENAI_MODEL` como variable opcional. Valor recomendado: `gpt-5.2`.

Podés también eliminar `OPENAI_MODEL`: el código probará automáticamente modelos de respaldo compatibles.

## Importante

- No pegues la clave en el código.
- No la agregues a `.env.example`.
- No la subas a GitHub.
- Si todavía existe `OPENAI_MODEL=gpt-5.6-sol` en Cloudflare, podés reemplazarlo por `gpt-5.2`. De todas formas esta versión tiene fallback automático si el modelo configurado falla.

## Prueba rápida después del deploy

Abrí el chatbot y probá, por ejemplo:

1. `¿Qué faltantes tengo de botellas?` -> debe usar los datos del ERP.
2. `¿Quién fue San Martín?` -> debe responder como asistente general.
3. `¿Cuál es el resultado de 125 por 37?` -> debe responder normalmente.
4. `¿Qué noticias importantes hay hoy?` -> puede usar búsqueda web.
5. Hacé una segunda pregunta relacionada con la anterior -> debe conservar el contexto reciente de la conversación.
