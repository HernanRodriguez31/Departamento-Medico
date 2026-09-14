export const getFunctions = () => ({});
export const httpsCallable = (functions, name) => async () => ({ data: name === "getMySessionControl" ? { forcePasswordChange: false } : {} });
