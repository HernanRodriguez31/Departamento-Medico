const getDefaultLocation = () =>
  typeof window !== "undefined" ? window.location : { hash: "" };

export const getCurrentHash = (locationLike = getDefaultLocation()) => {
  const hash = locationLike?.hash;
  return typeof hash === "string" ? hash : "";
};

export const hashContains = (fragment, locationLike) =>
  getCurrentHash(locationLike).includes(String(fragment ?? ""));

export const hashStartsWith = (prefix, locationLike) =>
  getCurrentHash(locationLike).startsWith(String(prefix ?? ""));

export const isChatHash = (locationLike) => hashContains("chat", locationLike);

export const isForumHash = (locationLike) => hashStartsWith("#foro", locationLike);
