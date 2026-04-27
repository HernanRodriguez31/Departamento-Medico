const PROFILE_AVATAR_VERSION = "20260426-profile-avatars-1";

const withVersion = (path) => `${path}?v=${PROFILE_AVATAR_VERSION}`;

const normalizeIdentityKey = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/^(dr|dra)\.?\s+/i, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
};

const DEFAULT_PROFILE_AVATARS = Object.freeze([
  {
    uid: "HRodriguez",
    email: "HRodriguez@pan-energy.com",
    names: ["Hernan Rodriguez"],
    src: "/assets/images/coord-rodriguez-new.png"
  },
  {
    uid: "LCura",
    email: "LCura@pan-energy.com",
    names: ["Leila Cura", "Dra. Leila Cura"],
    src: "/assets/images/avatar-leila-cura-featured-tight-20260411.png"
  },
  {
    uid: "GSilva",
    email: "GSilva@pan-energy.com",
    names: ["Gustavo Silva"],
    src: "/assets/images/avatar-silva-new.png"
  },
  {
    uid: "JAzcarate",
    email: "JAzcarate@pan-energy.com",
    names: ["Juan Martin Azcarate"],
    src: "/assets/images/avatar-azcarate-new.png"
  },
  {
    uid: "JMaurino",
    email: "JMaurino@pan-energy.com",
    names: ["Juan Maurino"],
    src: "/assets/images/coord-maurino-new.png"
  },
  {
    uid: "MBianchi",
    email: "MBianchi@pan-energy.com",
    names: ["Mario Bianchi"],
    src: "/assets/images/coord-bianchi-new.png"
  },
  {
    uid: "SAciar",
    email: "SAciar@pan-energy.com",
    names: ["Sergio Aciar"],
    src: "/assets/images/coord-aciar-new.png"
  },
  {
    uid: "RSabha",
    email: "RSabha@pan-energy.com",
    names: ["Roberto Sabha"],
    src: "/assets/images/coord-sabha-new.png"
  }
]);

const byUid = new Map();
const byEmail = new Map();
const byName = new Map();

DEFAULT_PROFILE_AVATARS.forEach((entry) => {
  byUid.set(normalizeIdentityKey(entry.uid), entry);
  byEmail.set(normalizeIdentityKey(entry.email), entry);
  entry.names.forEach((name) => byName.set(normalizeIdentityKey(name), entry));
});

const resolveDefaultAvatarEntry = ({ uid = "", email = "", name = "" } = {}) => {
  return (
    byUid.get(normalizeIdentityKey(uid)) ||
    byEmail.get(normalizeIdentityKey(email)) ||
    byName.get(normalizeIdentityKey(name)) ||
    null
  );
};

const resolveDefaultAvatarUrl = (identity = {}) => {
  const entry = resolveDefaultAvatarEntry(identity);
  return entry ? withVersion(entry.src) : "";
};

const getDefaultAvatarMigrationRows = () =>
  DEFAULT_PROFILE_AVATARS.map((entry) => ({
    uid: entry.uid,
    email: entry.email,
    defaultAvatarUrl: withVersion(entry.src)
  }));

export {
  PROFILE_AVATAR_VERSION,
  DEFAULT_PROFILE_AVATARS,
  getDefaultAvatarMigrationRows,
  normalizeIdentityKey,
  resolveDefaultAvatarEntry,
  resolveDefaultAvatarUrl
};
