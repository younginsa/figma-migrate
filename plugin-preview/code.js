// Figma-migrate plugin — preview mode
// This is the v0.1 mockup running inside Figma's plugin sandbox.
// No real Figma write logic yet; just shows the UI at real plugin dimensions
// so the design can be reviewed in context.

figma.showUI(__html__, {
  width: 380,
  height: 800,
  title: "Figma-migrate (Preview)",
});

// Stub message handler — the real plugin will route parse/build/etc. through here.
figma.ui.onmessage = (msg) => {
  if (msg.type === "close") {
    figma.closePlugin();
  }
};
