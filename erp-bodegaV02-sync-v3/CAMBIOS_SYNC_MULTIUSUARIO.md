# Sincronización multiusuario

## Objetivo

Evitar que cada navegador consulte Google Sheets por su cuenta. La programación se comparte en Cloudflare D1 y una sola instancia del Worker puede actualizar Google por ciclo.

## Cambios

- `lib/google-sheets.ts`: D1 pasa a ser la caché compartida; se elimina la coordinación por memoria local del Worker.
- `db/index.ts`: crea automáticamente `program_sync_state` y `program_sync_lock`, usadas para estado y lease distribuido.
- `app/api/program/route.ts`: la actualización automática usa un request líder que espera a Google y guarda D1 antes de responder; los demás dispositivos leen D1.
- `app/page.tsx`: cada navegador inicia el ciclo cada 30 s, recibe primero D1 y vuelve a consultar solo D1 8 s después para reflejar la lectura terminada.
- `lib/app-settings.ts`: valores recomendados por defecto 30 s / 30 s.
- Google Sheets usa reintentos acotados para fallas transitorias.

## Flujo

1. Los usuarios llaman `/api/program?background=1`.
2. La respuesta sale desde `program_cache` en D1.
3. En segundo plano los Workers intentan obtener el lease `google-sheets`.
4. Solo el Worker que obtiene el lease consulta Google Sheets.
5. El resultado se guarda en `program_cache`.
6. Ocho segundos después los navegadores consultan `/api/program?stored=1`, que solo lee D1.

## Después del despliegue

En Administración > Configuración se recomienda:

- Sincronización automática: `30` segundos.
- Caché compartida: `30` segundos.

La tabla nueva se crea automáticamente al primer acceso; no requiere ejecutar una migración manual.

## Prueba práctica

1. Abrir el ERP en dos o más dispositivos.
2. Dejar visible la pantalla durante al menos dos ciclos.
3. Cambiar una fila de la programación de Google Sheets.
4. Confirmar que todos los dispositivos terminan mostrando la misma `Última lectura` y el mismo cambio.
5. Probar `Actualizar ahora` en dos dispositivos casi al mismo tiempo; el lease global evita dos lecturas simultáneas de Google.

El código está diseñado para que la cantidad de lecturas de Google no aumente con la cantidad de usuarios. Una garantía numérica de concurrencia requiere una prueba de carga sobre el deployment real de Cloudflare y sus límites contratados.

## Corrección v2 - interfaz no bloqueante

Se corrigió un problema de experiencia introducido en la primera versión multiusuario: cada ciclo automático dejaba el botón superior en **Actualizando...** y esperaba 8 segundos antes de volver a leer D1. Con muchos usuarios esto podía dar la sensación de que el ERP quedaba colgado y, en un primer despliegue sin `program_cache`, podía dejar la pantalla temporalmente en cero.

La versión v2 cambia ese flujo:

- el primer ingreso usa una lectura estándar y, si D1 está vacío, espera al único Worker líder que carga Google Sheets;
- una vez que D1 tiene datos, abrir el ERP devuelve D1 de inmediato;
- los ciclos automáticos no muestran el spinner grande ni esperan 8 segundos;
- la revalidación de Google se ejecuta dentro del request líder con lock distribuido;
- **Actualizar ahora** sigue siendo una acción explícita que sí espera el resultado;
- si Google falla, la última programación real de D1 permanece disponible.
