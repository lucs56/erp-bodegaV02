# Subir a erp-bodegaV02

Copiar todo el contenido de esta carpeta sobre el repositorio local `erp-bodegaV02`, conservando la carpeta oculta `.git`.

```bash
git status
git add -A
git commit -m "Corregir sincronizacion multiusuario de Google Sheets"
git push origin main
```

Si GitHub tiene cambios más nuevos:

```bash
git pull --rebase origin main
git push origin main
```
