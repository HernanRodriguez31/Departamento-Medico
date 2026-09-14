// Stub de firebase-app para verificación sin red.
const apps = [];
export function initializeApp(config, name = "[DEFAULT]") {
  const app = { name, options: config };
  apps.push(app);
  return app;
}
export const getApps = () => apps;
export const getApp = (name) => apps.find((a) => a.name === name) || apps[0];
