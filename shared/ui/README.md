# For You V2 UI Styles

Deze map bevat de gedeelde visuele basis voor nieuwe V2-modulepagina's.

Gebruik `foryou-v2.css` als startpunt voor nieuwe schermen. De stijl is gebaseerd op de bestaande pagina's die goed werken:

- `legacy/public/algoritme.html`
- `app/public/paden.html`
- `For_universe/src/public/styles.css`

## Regels

- V1-pariteit eerst: behoud bestaande werkende UI-patronen.
- Geen nieuwe sidebar/admin-stijl tenzij daar expliciet om gevraagd is.
- Editorpagina's gebruiken standaard de lichte werkstijl.
- Stage/Universe-achtige visualisaties gebruiken `.fy-theme-stage`.
- Layouts voor catalogus/editorwerk gebruiken compacte panels, scrollbare lijsten en maximaal drie kolommen op desktop.
- Nieuwe module-UI's mogen deze stylesheet uitbreiden, maar niet een totaal eigen visuele taal introduceren zonder akkoord.

## Voorbeeld

```html
<link rel="stylesheet" href="/shared/ui/foryou-v2.css">
<body class="fy-page">
  <header class="fy-topbar">
    <div class="fy-bar">
      <div class="fy-brand">
        <span class="fy-brand-mark">FY</span>
        <div class="fy-brand-text">
          <strong>Catalogus</strong>
          <span>V2 module</span>
        </div>
      </div>
      <div class="fy-actions">
        <button class="fy-button">Refresh</button>
        <button class="fy-button fy-button-primary">Opslaan</button>
      </div>
    </div>
  </header>
  <main class="fy-main">
    <section class="fy-grid-3">
      <article class="fy-window">
        <div class="fy-window-header"><h2>Personages</h2></div>
        <div class="fy-window-body">
          <div class="fy-scroll-list"></div>
        </div>
      </article>
    </section>
  </main>
</body>
```
