const SCIENTIFIC_METHODOLOGY_TAXONOMY = {
  experimental_interventional: {
    labelEs: "Estudio experimental / intervención",
    designs: [
      "Ensayo clínico aleatorizado",
      "Ensayo clínico no aleatorizado",
      "Ensayo pragmático",
      "Ensayo por conglomerados",
      "Crossover",
      "Stepped-wedge",
      "No inferioridad",
      "Superioridad"
    ],
    signals: [
      "randomized",
      "randomised",
      "random allocation",
      "trial",
      "intervention",
      "control group",
      "blinding",
      "double blind",
      "single blind",
      "placebo",
      "parallel group",
      "cluster",
      "crossover"
    ],
    requiredFields: [
      "interventionOrExposure",
      "comparator",
      "allocation",
      "masking",
      "primaryOutcome",
      "followUpDuration",
      "sampleSize"
    ],
    reportingGuidelines: ["CONSORT"]
  },
  observational_analytical: {
    labelEs: "Estudio observacional analítico",
    designs: [
      "Cohorte prospectiva",
      "Cohorte retrospectiva",
      "Cohorte ambispectiva",
      "Caso-control",
      "Transversal analítico"
    ],
    signals: [
      "cohort",
      "prospective",
      "retrospective",
      "case-control",
      "cross-sectional",
      "registry",
      "electronic health records",
      "medical records",
      "follow-up",
      "incidence",
      "risk ratio",
      "odds ratio",
      "hazard ratio"
    ],
    requiredFields: [
      "temporalDirection",
      "dataSource",
      "population",
      "sampleSize",
      "studyPeriod",
      "exposure",
      "outcome",
      "statisticalApproach"
    ],
    reportingGuidelines: ["STROBE"]
  },
  observational_descriptive: {
    labelEs: "Estudio observacional descriptivo",
    designs: [
      "Reporte de caso",
      "Serie de casos",
      "Transversal descriptivo",
      "Ecológico",
      "Registro descriptivo"
    ],
    signals: [
      "case report",
      "case series",
      "descriptive",
      "cross-sectional survey",
      "ecological",
      "prevalence",
      "registry description"
    ],
    requiredFields: ["population", "sampleSize", "setting", "countryOrRegion", "studyPeriod"],
    reportingGuidelines: ["CARE", "STROBE"]
  },
  evidence_synthesis: {
    labelEs: "Síntesis de evidencia",
    designs: [
      "Revisión sistemática",
      "Metaanálisis",
      "Scoping review",
      "Umbrella review",
      "Revisión narrativa"
    ],
    signals: [
      "systematic review",
      "meta-analysis",
      "PRISMA",
      "databases searched",
      "search strategy",
      "inclusion criteria",
      "risk of bias",
      "quality assessment",
      "pooled estimate",
      "forest plot"
    ],
    requiredFields: ["databasesSearched", "searchPeriod", "includedStudies", "riskOfBias", "synthesisMethod"],
    reportingGuidelines: ["PRISMA"]
  },
  guideline_consensus: {
    labelEs: "Guía clínica / consenso",
    designs: [
      "Guía de práctica clínica",
      "Consenso",
      "Consenso Delphi",
      "Documento de posición",
      "Recomendación institucional"
    ],
    signals: [
      "guideline",
      "recommendation",
      "consensus",
      "Delphi",
      "expert panel",
      "GRADE",
      "strength of recommendation",
      "clinical practice guideline",
      "position statement"
    ],
    requiredFields: [
      "panelComposition",
      "evidenceReviewMethod",
      "consensusMethod",
      "recommendationStrength",
      "targetPopulation"
    ],
    reportingGuidelines: ["AGREE II", "GRADE"]
  },
  implementation_health_policy: {
    labelEs: "Política sanitaria / implementación",
    designs: [
      "Health Policy",
      "Marco de implementación",
      "Quality improvement",
      "Evaluación de programa",
      "Informe técnico",
      "Policy framework",
      "Implementation framework"
    ],
    signals: [
      "health policy",
      "policy framework",
      "implementation",
      "implementation science",
      "quality improvement",
      "programmatic strategies",
      "framework development",
      "formative process",
      "evidence review",
      "expert consensus",
      "stakeholders",
      "scale-up",
      "institutionalization",
      "monitoring and evaluation",
      "Plan-Do-Study-Act",
      "PDSA",
      "program evaluation"
    ],
    requiredFields: [
      "programOrFramework",
      "countryOrRegion",
      "institutions",
      "stakeholders",
      "implementationPeriod",
      "dataSource",
      "programmaticScope",
      "indicators"
    ],
    reportingGuidelines: ["SQUIRE", "TIDieR", "AGREE-HS"]
  },
  diagnostic_prognostic: {
    labelEs: "Estudio diagnóstico / pronóstico",
    designs: [
      "Precisión diagnóstica",
      "Validación diagnóstica",
      "Estudio pronóstico",
      "Biomarcadores",
      "Screening"
    ],
    signals: [
      "diagnostic accuracy",
      "sensitivity",
      "specificity",
      "reference standard",
      "ROC",
      "AUC",
      "predictive value",
      "prognostic"
    ],
    requiredFields: ["indexTest", "referenceStandard", "sensitivity", "specificity", "auc", "population", "sampleSize"],
    reportingGuidelines: ["STARD", "TRIPOD"]
  },
  prediction_model: {
    labelEs: "Modelo predictivo",
    designs: [
      "Desarrollo de modelo predictivo",
      "Validación interna",
      "Validación externa",
      "Modelo diagnóstico",
      "Modelo pronóstico",
      "Modelo con machine learning"
    ],
    signals: [
      "prediction model",
      "machine learning",
      "model development",
      "validation cohort",
      "external validation",
      "calibration",
      "discrimination",
      "C-statistic",
      "TRIPOD"
    ],
    requiredFields: [
      "modelType",
      "developmentCohort",
      "validationCohort",
      "predictors",
      "outcome",
      "calibration",
      "discrimination"
    ],
    reportingGuidelines: ["TRIPOD", "TRIPOD+AI"]
  },
  economic_evaluation: {
    labelEs: "Evaluación económica",
    designs: [
      "Costo-efectividad",
      "Costo-utilidad",
      "Impacto presupuestario",
      "Modelo de Markov",
      "Análisis de sensibilidad"
    ],
    signals: [
      "cost-effectiveness",
      "cost-utility",
      "budget impact",
      "Markov model",
      "incremental cost-effectiveness ratio",
      "ICER",
      "quality-adjusted life years",
      "QALY",
      "DALY"
    ],
    requiredFields: ["perspective", "timeHorizon", "costs", "outcomes", "sensitivityAnalysis"],
    reportingGuidelines: ["CHEERS"]
  },
  qualitative_mixed_methods: {
    labelEs: "Cualitativo / métodos mixtos",
    designs: [
      "Estudio cualitativo",
      "Métodos mixtos",
      "Entrevistas",
      "Grupos focales",
      "Análisis temático"
    ],
    signals: [
      "qualitative",
      "mixed methods",
      "interviews",
      "focus groups",
      "thematic analysis",
      "grounded theory",
      "content analysis",
      "saturation"
    ],
    requiredFields: ["samplingStrategy", "participants", "analysisMethod", "triangulation", "saturation"],
    reportingGuidelines: ["COREQ", "SRQR"]
  },
  other_unclear: {
    labelEs: "Otro / no claro",
    designs: ["No especificado", "Comentario", "Editorial", "Perspectiva", "Carta", "Otro"],
    signals: [],
    requiredFields: [],
    reportingGuidelines: []
  }
};

const STUDY_FAMILIES = Object.keys(SCIENTIFIC_METHODOLOGY_TAXONOMY);

const STUDY_FAMILY_LABELS_ES = STUDY_FAMILIES.reduce((labels, family) => {
  labels[family] = SCIENTIFIC_METHODOLOGY_TAXONOMY[family].labelEs;
  return labels;
}, {});

const EVIDENCE_SUPPORT_FIELDS = [
  "specificDesign",
  "temporalDirection",
  "centerScope",
  "studyPopulation",
  "sampleSize",
  "studyPeriod",
  "institutions"
];

const SUPPORT_LEVELS = ["explicito", "inferido_con_soporte", "no_especificado", "no_aplica"];

const METHODOLOGY_PROFILE_KEYS = [
  "studyFamily",
  "studyFamilyEs",
  "specificDesign",
  "designCategoryEs",
  "temporalDirection",
  "centerScope",
  "isMulticenter",
  "multicenterRationale",
  "setting",
  "countryOrRegion",
  "countriesIncluded",
  "institutions",
  "studyPopulation",
  "sampleSize",
  "sampleDescription",
  "studyPeriod",
  "studyDuration",
  "recruitmentPeriod",
  "followUpDuration",
  "dataSource",
  "interventionOrExposure",
  "comparator",
  "primaryOutcome",
  "secondaryOutcomes",
  "statisticalApproach",
  "effectMeasures",
  "reportingGuideline",
  "methodologicalStrengths",
  "methodologicalLimitations",
  "applicabilityNotes",
  "classificationRationale",
  "classificationConfidence",
  "evidenceSupport",
  "methodologyWarnings"
];

const METHODOLOGY_LIST_FIELDS = new Set([
  "countriesIncluded",
  "institutions",
  "secondaryOutcomes",
  "effectMeasures",
  "methodologicalStrengths",
  "methodologicalLimitations",
  "applicabilityNotes",
  "methodologyWarnings"
]);

const METHODOLOGY_BOOLEAN_FIELDS = new Set(["isMulticenter"]);
const METHODOLOGY_OBJECT_FIELDS = new Set(["evidenceSupport"]);

const METHODOLOGY_EVIDENCE_BUCKETS = [
  {
    key: "abstractOrSummary",
    heading: "Abstract / Summary",
    patterns: [/abstract/i, /summary/i, /resumen/i],
    importanceScore: 1
  },
  {
    key: "introduction",
    heading: "Introduction / Background",
    patterns: [/intro/i, /background/i, /antecedentes/i],
    importanceScore: 0.78
  },
  {
    key: "methods",
    heading: "Methods / Methodology",
    patterns: [/method/i, /m[eé]todo/i, /methodology/i],
    importanceScore: 1
  },
  {
    key: "studyDesign",
    heading: "Study design",
    patterns: [/study design/i, /design/i, /diseño/i, /trial design/i],
    importanceScore: 0.96
  },
  {
    key: "participantsPopulationSetting",
    heading: "Population / Participants / Setting",
    patterns: [/participant/i, /population/i, /setting/i, /patients/i, /poblaci/i, /ámbito/i, /ambito/i],
    importanceScore: 0.94
  },
  {
    key: "dataSource",
    heading: "Data source",
    patterns: [/data source/i, /registry/i, /records/i, /database/i, /fuente de datos/i],
    importanceScore: 0.9
  },
  {
    key: "interventionExposure",
    heading: "Intervention / Exposure",
    patterns: [/intervention/i, /exposure/i, /program/i, /framework/i, /intervenci/i, /exposici/i],
    importanceScore: 0.86
  },
  {
    key: "comparator",
    heading: "Comparator",
    patterns: [/comparator/i, /control group/i, /placebo/i, /comparador/i],
    importanceScore: 0.82
  },
  {
    key: "outcomes",
    heading: "Outcomes",
    patterns: [/outcome/i, /endpoint/i, /primary outcome/i, /desenlace/i, /resultado principal/i],
    importanceScore: 0.9
  },
  {
    key: "statisticalAnalysis",
    heading: "Statistical analysis",
    patterns: [/statistical/i, /analysis/i, /análisis estad/i, /analisis estad/i],
    importanceScore: 0.84
  },
  {
    key: "searchStrategy",
    heading: "Search strategy",
    patterns: [/search strategy/i, /databases searched/i, /selection criteria/i, /estrategia de b/i],
    importanceScore: 0.92
  },
  {
    key: "selectionCriteria",
    heading: "Selection criteria",
    patterns: [/inclusion criteria/i, /exclusion criteria/i, /selection criteria/i, /criterios/i],
    importanceScore: 0.84
  },
  {
    key: "formativeProcess",
    heading: "Formative process",
    patterns: [/formative process/i, /framework development/i, /evidence review/i, /processo formativo/i],
    importanceScore: 0.94
  },
  {
    key: "consensusProcess",
    heading: "Consensus process",
    patterns: [/consensus/i, /delphi/i, /expert panel/i, /GRADE/i, /panel de expertos/i],
    importanceScore: 0.9
  },
  {
    key: "implementationFramework",
    heading: "Implementation framework",
    patterns: [/implementation/i, /quality framework/i, /policy framework/i, /health policy/i, /implementaci/i],
    importanceScore: 0.95
  },
  {
    key: "qualityImprovement",
    heading: "Quality improvement",
    patterns: [/quality improvement/i, /PDSA/i, /Plan-Do-Study-Act/i, /mejora de calidad/i],
    importanceScore: 0.88
  },
  {
    key: "resultsFindings",
    heading: "Results / Findings",
    patterns: [/results/i, /findings/i, /resultados/i, /hallazgos/i],
    importanceScore: 0.76
  },
  {
    key: "discussion",
    heading: "Discussion",
    patterns: [/discussion/i, /discusi/i, /interpretation/i],
    importanceScore: 0.7
  },
  {
    key: "limitations",
    heading: "Limitations",
    patterns: [/limitations/i, /limitaciones/i],
    importanceScore: 0.72
  },
  {
    key: "tablesAndFigureCaptions",
    heading: "Tables / Figure captions",
    patterns: [/table/i, /figure/i, /panel/i, /cuadro/i, /tabla/i, /figura/i],
    importanceScore: 0.62
  }
];

const cleanString = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

const normalizeForMatch = (value = "") =>
  cleanString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const normalizeStringList = (value = [], limit = 12) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : String(value || "").split(/[,;|]/))
        .map(cleanString)
        .filter(Boolean)
    )
  ).slice(0, limit);

const buildEmptyEvidenceSupport = () =>
  EVIDENCE_SUPPORT_FIELDS.reduce((support, key) => {
    support[key] = {
      supportLevel: key === "sampleSize" ? "no_aplica" : "no_especificado",
      evidenceText: "",
      sourceSection: ""
    };
    return support;
  }, {});

const normalizeSupportLevel = (value = "") => {
  const clean = cleanString(value);
  return SUPPORT_LEVELS.includes(clean) ? clean : "no_especificado";
};

const normalizeEvidenceSupport = (input = {}) => {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const empty = buildEmptyEvidenceSupport();
  EVIDENCE_SUPPORT_FIELDS.forEach((key) => {
    const item = raw[key] && typeof raw[key] === "object" && !Array.isArray(raw[key]) ? raw[key] : {};
    empty[key] = {
      supportLevel: normalizeSupportLevel(item.supportLevel),
      evidenceText: cleanString(item.evidenceText).slice(0, 420),
      sourceSection: cleanString(item.sourceSection).slice(0, 120)
    };
  });
  return empty;
};

const buildEmptyMethodologyProfile = () =>
  METHODOLOGY_PROFILE_KEYS.reduce((profile, key) => {
    if (METHODOLOGY_LIST_FIELDS.has(key)) profile[key] = [];
    else if (METHODOLOGY_BOOLEAN_FIELDS.has(key)) profile[key] = false;
    else if (METHODOLOGY_OBJECT_FIELDS.has(key)) profile[key] = buildEmptyEvidenceSupport();
    else profile[key] = "";
    return profile;
  }, {});

const normalizeStudyFamily = (value = "") => {
  const clean = cleanString(value);
  return STUDY_FAMILIES.includes(clean) ? clean : "other_unclear";
};

const normalizeBoolean = (value) => value === true || value === "true" || value === "sí" || value === "si";

const normalizeMethodologyProfile = (input = {}) => {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const profile = buildEmptyMethodologyProfile();
  METHODOLOGY_PROFILE_KEYS.forEach((key) => {
    if (METHODOLOGY_LIST_FIELDS.has(key)) {
      profile[key] = normalizeStringList(raw[key], key === "methodologyWarnings" ? 8 : 12);
    } else if (METHODOLOGY_BOOLEAN_FIELDS.has(key)) {
      profile[key] = normalizeBoolean(raw[key]);
    } else if (key === "evidenceSupport") {
      profile[key] = normalizeEvidenceSupport(raw[key]);
    } else {
      profile[key] = cleanString(raw[key]);
    }
  });
  profile.studyFamily = normalizeStudyFamily(profile.studyFamily);
  profile.studyFamilyEs = profile.studyFamilyEs || STUDY_FAMILY_LABELS_ES[profile.studyFamily] || "";
  if (!profile.designCategoryEs) {
    profile.designCategoryEs = profile.specificDesign || profile.studyFamilyEs;
  }
  return profile;
};

const inferDesignCategoryFromProfile = (profile = {}) =>
  cleanString(profile.designCategoryEs || profile.specificDesign || profile.studyFamilyEs);

const getEvidenceEntries = (evidencePacket = {}) => {
  const entries = [];
  const addEntry = (heading, text, pages = []) => {
    const cleanText = cleanString(text);
    if (!cleanText) return;
    entries.push({
      heading: cleanString(heading) || "Texto científico",
      text: cleanText,
      pages: Array.isArray(pages) ? pages : []
    });
  };

  if (evidencePacket.detectedMetadata) {
    addEntry("Title / Metadata", [
      evidencePacket.detectedMetadata.title,
      evidencePacket.detectedMetadata.description,
      evidencePacket.detectedMetadata.summary,
      evidencePacket.detectedMetadata.abstract,
      evidencePacket.detectedMetadata.keywords
    ].flat().filter(Boolean).join(" "));
  }
  Object.values(evidencePacket.methodologyEvidence || {}).forEach((section) => {
    addEntry(section.heading, section.text, section.pages);
  });
  (evidencePacket.sections || []).forEach((section) => addEntry(section.heading, section.text, section.pages));
  (evidencePacket.visibleTextSections || []).forEach((section) => addEntry(section.heading, section.text, section.pages));
  (evidencePacket.snippets || []).forEach((snippet) => addEntry(snippet.label, snippet.text, snippet.pages));
  return entries;
};

const detectSignalsInText = (text = "", taxonomy = SCIENTIFIC_METHODOLOGY_TAXONOMY) => {
  const normalized = normalizeForMatch(text);
  const matches = [];
  Object.entries(taxonomy).forEach(([family, config]) => {
    (config.signals || []).forEach((signal) => {
      if (normalized.includes(normalizeForMatch(signal))) {
        matches.push({ family, signal });
      }
    });
  });
  return matches;
};

const buildMethodologyEvidence = (input = {}) => {
  const entries = getEvidenceEntries(input);
  const sourceText = entries.length
    ? entries.map((entry) => `${entry.heading}\n${entry.text}`).join("\n\n")
    : cleanString(input.fullText || input.text || input.publicText || "");
  const fallbackEntries = entries.length ? entries : [{ heading: "Texto científico", text: sourceText, pages: [] }];

  return METHODOLOGY_EVIDENCE_BUCKETS.reduce((evidence, bucket) => {
    const matched = fallbackEntries
      .filter((entry) => {
        const haystack = `${entry.heading}\n${entry.text}`;
        return bucket.patterns.some((pattern) => pattern.test(haystack));
      })
      .slice(0, 3);
    const source = matched.length ? matched : bucket.key === "abstractOrSummary" ? fallbackEntries.slice(0, 1) : [];
    const text = source.map((entry) => entry.text).join("\n\n").slice(0, bucket.importanceScore >= 0.9 ? 3600 : 2200);
    const detectedSignals = detectSignalsInText(`${bucket.heading}\n${text}`).map((item) => item.signal).slice(0, 12);
    evidence[bucket.key] = {
      heading: bucket.heading,
      text,
      pages: source.flatMap((entry) => entry.pages || []).slice(0, 10),
      importanceScore: bucket.importanceScore,
      detectedSignals
    };
    return evidence;
  }, {});
};

const inferLikelyDesigns = (text = "", possibleFamilies = []) => {
  const normalized = normalizeForMatch(text);
  const designs = [];
  const add = (value) => {
    if (value && !designs.includes(value)) designs.push(value);
  };
  if (/randomi[sz]ed/.test(normalized) && normalized.includes("trial")) add("Ensayo clínico aleatorizado");
  if (normalized.includes("pragmatic trial")) add("Ensayo pragmático");
  if (normalized.includes("cluster") && normalized.includes("trial")) add("Ensayo por conglomerados");
  if (normalized.includes("cohort") && normalized.includes("retrospective")) add("Cohorte retrospectiva");
  if (normalized.includes("cohort") && normalized.includes("prospective")) add("Cohorte prospectiva");
  if (normalized.includes("case-control")) add("Caso-control");
  if (normalized.includes("cross-sectional")) add("Estudio transversal");
  if (normalized.includes("systematic review")) add("Revisión sistemática");
  if (normalized.includes("meta-analysis")) add("Metaanálisis");
  if (normalized.includes("scoping review")) add("Scoping review");
  if (normalized.includes("guideline")) add("Guía de práctica clínica");
  if (normalized.includes("delphi")) add("Consenso Delphi");
  if (normalized.includes("consensus")) add("Consenso");
  if (normalized.includes("health policy")) add("Health Policy");
  if (normalized.includes("policy framework") || normalized.includes("implementation framework")) add("Marco de implementación");
  if (normalized.includes("quality improvement")) add("Quality improvement");
  if (normalized.includes("diagnostic accuracy")) add("Precisión diagnóstica");
  if (normalized.includes("prediction model")) add("Desarrollo de modelo predictivo");
  if (normalized.includes("cost-effectiveness")) add("Costo-efectividad");
  if (normalized.includes("qualitative")) add("Estudio cualitativo");

  possibleFamilies.forEach((family) => {
    const defaults = SCIENTIFIC_METHODOLOGY_TAXONOMY[family]?.designs || [];
    if (!designs.length && defaults[0]) add(defaults[0]);
  });
  return designs.slice(0, 6);
};

const preclassifyMethodology = (evidencePacket = {}, taxonomy = SCIENTIFIC_METHODOLOGY_TAXONOMY) => {
  const entries = getEvidenceEntries(evidencePacket);
  const combinedText = entries.map((entry) => `${entry.heading}\n${entry.text}`).join("\n\n");
  const normalizedText = normalizeForMatch(combinedText);
  const scoreByFamily = STUDY_FAMILIES.reduce((scores, family) => {
    scores[family] = 0;
    return scores;
  }, {});
  const signalMatches = [];

  entries.forEach((entry) => {
    detectSignalsInText(`${entry.heading}\n${entry.text}`, taxonomy).forEach((match) => {
      const sectionWeight = /method|design|summary|abstract|strategy|framework|population|setting/i.test(entry.heading) ? 2 : 1;
      scoreByFamily[match.family] += sectionWeight;
      signalMatches.push({
        family: match.family,
        signal: match.signal,
        section: entry.heading,
        page: Array.isArray(entry.pages) && entry.pages.length ? entry.pages[0] : undefined
      });
    });
  });

  const boost = (family, amount) => {
    scoreByFamily[family] = (scoreByFamily[family] || 0) + amount;
  };
  if (/randomi[sz]ed.{0,28}trial|trial.{0,28}randomi[sz]ed/.test(normalizedText)) boost("experimental_interventional", 8);
  if (/systematic review|meta-analysis|prisma/.test(normalizedText)) boost("evidence_synthesis", 8);
  if (/guideline|delphi|grade|expert panel|consensus/.test(normalizedText)) boost("guideline_consensus", 6);
  if (/health policy|policy framework|implementation framework|quality improvement|formative process|implementation science/.test(normalizedText)) {
    boost("implementation_health_policy", 8);
  }
  if (/cohort|retrospective|prospective|case-control|cross-sectional/.test(normalizedText)) boost("observational_analytical", 5);
  if (/case report|case series|prevalence|descriptive/.test(normalizedText)) boost("observational_descriptive", 4);
  if (/diagnostic accuracy|sensitivity|specificity|reference standard|auc|roc/.test(normalizedText)) boost("diagnostic_prognostic", 5);
  if (/prediction model|machine learning|calibration|discrimination|external validation/.test(normalizedText)) boost("prediction_model", 5);
  if (/cost-effectiveness|cost-utility|budget impact|icer|qaly|daly/.test(normalizedText)) boost("economic_evaluation", 5);
  if (/qualitative|mixed methods|interviews|focus groups|thematic analysis/.test(normalizedText)) boost("qualitative_mixed_methods", 5);

  const ranked = Object.entries(scoreByFamily)
    .filter(([family, score]) => family !== "other_unclear" && score > 0)
    .sort((a, b) => b[1] - a[1]);
  const possibleFamilies = ranked.length ? ranked.map(([family]) => family).slice(0, 4) : ["other_unclear"];
  const likelyDesigns = inferLikelyDesigns(combinedText, possibleFamilies);
  const explicitClaims = signalMatches
    .filter((match) => /summary|abstract|method|design|strategy|framework/i.test(match.section))
    .map((match) => `${match.signal} (${match.section})`)
    .slice(0, 10);
  const inferredClaims = [];
  if (
    possibleFamilies[0] === "implementation_health_policy" &&
    /(countries|pa[ií]ses|ministries|ministerios|regional|international|americas|am[eé]ricas)/.test(normalizedText)
  ) {
    inferredClaims.push("El relato sugiere alcance regional/internacional programático, no multicéntrico clínico.");
  }
  if (possibleFamilies[0] === "evidence_synthesis" && /databases|search strategy|inclusion criteria/.test(normalizedText)) {
    inferredClaims.push("La presencia de estrategia de búsqueda y criterios de selección sostiene síntesis de evidencia.");
  }

  const topFamily = possibleFamilies[0];
  const requiredFields = taxonomy[topFamily]?.requiredFields || [];
  const missingMethodologyFields = requiredFields
    .filter((field) => !normalizeForMatch(combinedText).includes(normalizeForMatch(field)))
    .slice(0, 10);
  const topScore = ranked[0]?.[1] || 0;
  const secondScore = ranked[1]?.[1] || 0;
  const warnings = [];
  if (!ranked.length) warnings.push("No se detectaron señales metodológicas suficientes para una clasificación firme.");
  if (topScore && secondScore && topScore - secondScore <= 2) {
    warnings.push("Hay señales metodológicas competitivas; la IA debe justificar la clasificación final.");
  }
  if (
    topFamily === "implementation_health_policy" &&
    /(multiple centers|multicenter|multi-center)/.test(normalizedText)
  ) {
    warnings.push("Verificar si 'multicéntrico' se usa como alcance programático o como estudio clínico multicéntrico.");
  }

  return {
    possibleFamilies,
    signalMatches: signalMatches.slice(0, 40),
    likelyDesigns,
    explicitClaims,
    inferredClaims,
    missingMethodologyFields,
    preliminaryConfidence: Math.max(0.15, Math.min(0.95, 0.25 + topScore * 0.055 - Math.max(0, 2 - (topScore - secondScore)) * 0.04)),
    warnings
  };
};

module.exports = {
  EVIDENCE_SUPPORT_FIELDS,
  METHODOLOGY_BOOLEAN_FIELDS,
  METHODOLOGY_LIST_FIELDS,
  METHODOLOGY_OBJECT_FIELDS,
  METHODOLOGY_PROFILE_KEYS,
  SCIENTIFIC_METHODOLOGY_TAXONOMY,
  STUDY_FAMILIES,
  STUDY_FAMILY_LABELS_ES,
  SUPPORT_LEVELS,
  buildEmptyEvidenceSupport,
  buildEmptyMethodologyProfile,
  buildMethodologyEvidence,
  inferDesignCategoryFromProfile,
  normalizeEvidenceSupport,
  normalizeMethodologyProfile,
  normalizeStringList,
  preclassifyMethodology
};
