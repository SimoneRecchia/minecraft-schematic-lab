export function ClaudeHintPanel() {
  return (
    <section className="panel claude-hint">
      <h2 className="panel-title">Driven by Claude</h2>
      <p>Ask Claude to build something, for example:</p>
      <p className="example-prompt">“build me a 50×40×80 fantasy castle”</p>
      <p className="muted">
        This preview updates by itself as Claude builds or changes the schematic. Export it below, or
        go back to Claude and ask for changes, an export, or to save versions.
      </p>
    </section>
  );
}
