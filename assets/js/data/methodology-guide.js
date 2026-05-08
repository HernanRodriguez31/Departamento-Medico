export const METHODOLOGY_TERMS = {
  observacional: {
    label: "Observacional",
    category: "Intervención",
    definition: "El investigador observa lo que ocurre sin asignar una intervención.",
    example: "Cohorte, caso-control o estudio transversal basado en registros clínicos.",
    note: "Permite estudiar asociaciones, pero requiere controlar sesgos y confusores."
  },
  experimental: {
    label: "Experimental",
    category: "Intervención",
    definition: "El investigador asigna una intervención o estrategia y evalúa sus efectos.",
    example: "Ensayo clínico aleatorizado con grupo control.",
    note: "Suele aportar alta capacidad causal si está bien diseñado."
  },
  cuasiExperimental: {
    label: "Cuasi-experimental",
    category: "Intervención",
    definition: "Evalúa una intervención sin asignación aleatoria estricta.",
    example: "Estudio antes-después de una intervención sanitaria.",
    note: "Útil en implementación, pero más vulnerable a sesgos temporales."
  },
  descriptivo: {
    label: "Descriptivo",
    category: "Objetivo",
    definition: "Describe frecuencia, distribución o características sin probar una asociación principal.",
    example: "Prevalencia de hipertensión en una población laboral.",
    note: "Ayuda a dimensionar problemas y generar hipótesis."
  },
  analitico: {
    label: "Analítico",
    category: "Objetivo",
    definition: "Evalúa asociaciones entre exposición, intervención, características o desenlaces.",
    example: "Comparar riesgo cardiovascular según exposición ocupacional.",
    note: "Debe explicitar variables, comparadores y control de confusión."
  },
  diagnostico: {
    label: "Diagnóstico",
    category: "Objetivo",
    definition: "Evalúa el rendimiento de una prueba o estrategia para identificar una condición.",
    example: "Sensibilidad y especificidad de un test frente a un estándar de referencia.",
    note: "Debe informar prueba índice, estándar de referencia y población evaluada."
  },
  pronostico: {
    label: "Pronóstico",
    category: "Objetivo",
    definition: "Estima riesgo futuro, evolución o desenlaces esperados en una población definida.",
    example: "Modelo que predice eventos cardiovasculares a 5 años.",
    note: "Debe separar desarrollo, validación y calibración cuando corresponde."
  },
  terapeutico: {
    label: "Terapéutico",
    category: "Objetivo",
    definition: "Evalúa el efecto de un tratamiento o intervención clínica.",
    example: "Ensayo de un nuevo antihipertensivo frente a tratamiento estándar.",
    note: "Debe definir intervención, comparador, desenlace y seguimiento."
  },
  preventivo: {
    label: "Preventivo",
    category: "Objetivo",
    definition: "Evalúa estrategias para evitar enfermedad, eventos o progresión.",
    example: "Programa de tamizaje o intervención de hábitos saludables.",
    note: "Suele requerir seguimiento y desenlaces clínicos o programáticos claros."
  },
  economico: {
    label: "Económico",
    category: "Objetivo",
    definition: "Analiza costos, consecuencias y eficiencia de alternativas sanitarias.",
    example: "Costo-efectividad de una intervención de control de hipertensión.",
    note: "Debe aclarar perspectiva, horizonte temporal y análisis de sensibilidad."
  },
  prospectivo: {
    label: "Prospectivo",
    category: "Tiempo",
    definition: "Recolecta datos hacia adelante desde un punto inicial definido.",
    example: "Cohorte que sigue pacientes durante 12 meses.",
    note: "Permite definir mejor variables y seguimiento antes de que ocurra el desenlace."
  },
  retrospectivo: {
    label: "Retrospectivo",
    category: "Tiempo",
    definition: "Analiza datos ya ocurridos, habitualmente desde historias clínicas, bases administrativas o registros.",
    example: "Cohorte retrospectiva con registros hospitalarios de los últimos 5 años.",
    note: "Depende mucho de la calidad del registro disponible."
  },
  ambispectivo: {
    label: "Ambispectivo",
    category: "Tiempo",
    definition: "Combina una fase retrospectiva con seguimiento prospectivo.",
    example: "Pacientes identificados en registros previos y seguidos luego por 6 meses.",
    note: "Debe aclarar qué parte de los datos corresponde a cada fase."
  },
  transversal: {
    label: "Transversal",
    category: "Seguimiento / dirección",
    definition: "Mide exposición y desenlace en un momento o período corto.",
    example: "Encuesta de prevalencia de hipertensión en una población laboral.",
    note: "Útil para prevalencia; limitado para inferir causalidad temporal."
  },
  longitudinal: {
    label: "Longitudinal",
    category: "Seguimiento",
    definition: "Observa cambios, eventos o desenlaces a lo largo del tiempo.",
    example: "Seguimiento de trabajadores durante un año para registrar incidencia.",
    note: "Permite evaluar evolución temporal."
  },
  cohorte: {
    label: "Cohorte",
    category: "Dirección",
    definition: "Parte de una población o exposición y observa la aparición de desenlaces.",
    example: "Cohorte de pacientes hipertensos seguida para evaluar eventos cardiovasculares.",
    note: "Puede ser prospectiva, retrospectiva o ambispectiva."
  },
  casoControl: {
    label: "Caso-control",
    category: "Dirección",
    definition: "Parte del desenlace: compara personas con el evento frente a controles sin el evento para buscar exposiciones previas.",
    example: "Casos con enfermedad ocupacional comparados con controles sin enfermedad.",
    note: "Útil para eventos raros; suele informar odds ratio."
  },
  ecologico: {
    label: "Ecológico",
    category: "Dirección",
    definition: "Analiza datos agregados por grupos, regiones o poblaciones, no individuos.",
    example: "Comparar tasas de control de hipertensión entre países.",
    note: "No permite inferir directamente relaciones individuales."
  },
  unicentrico: {
    label: "Unicéntrico",
    category: "Centros",
    definition: "Se realiza en un solo centro, institución o sitio de estudio.",
    example: "Estudio en un único hospital o servicio médico.",
    note: "Puede tener menor generalización externa."
  },
  bicentrico: {
    label: "Bicéntrico",
    category: "Centros",
    definition: "Incluye dos centros o instituciones participantes.",
    example: "Estudio realizado en dos hospitales.",
    note: "Debe aclarar si el protocolo fue común en ambos centros."
  },
  multicentrico: {
    label: "Multicéntrico",
    category: "Centros",
    definition: "Incluye dos o más centros, instituciones o sitios de estudio.",
    example: "Ensayo o cohorte realizada en hospitales de distintas ciudades.",
    note: "Puede mejorar la generalización, pero exige estandarización."
  },
  multinacional: {
    label: "Multinacional",
    category: "Centros",
    definition: "Incluye participantes, centros o datos de más de un país.",
    example: "Registro internacional de pacientes cardiovasculares.",
    note: "Debe considerar diferencias entre sistemas de salud."
  },
  sinControl: {
    label: "Sin control",
    category: "Comparador",
    definition: "No incluye un grupo o condición comparadora explícita.",
    example: "Serie de casos o evaluación antes-después sin grupo control.",
    note: "Limita la atribución causal de los cambios observados."
  },
  placebo: {
    label: "Placebo",
    category: "Comparador",
    definition: "Comparador inactivo diseñado para simular la intervención.",
    example: "Fármaco activo frente a comprimido placebo.",
    note: "Frecuente en ensayos clínicos cuando es éticamente aceptable."
  },
  controlActivo: {
    label: "Control activo",
    category: "Comparador",
    definition: "Compara la intervención con otra intervención efectiva o estándar.",
    example: "Nuevo antihipertensivo frente a tratamiento estándar.",
    note: "Útil cuando no sería ético usar placebo."
  },
  historico: {
    label: "Histórico",
    category: "Comparador",
    definition: "Usa datos previos como referencia para comparar con una intervención o período actual.",
    example: "Resultados posteriores a un programa comparados con el año anterior.",
    note: "Puede confundirse por cambios temporales no relacionados con la intervención."
  },
  autocontrolado: {
    label: "Autocontrolado",
    category: "Comparador",
    definition: "Compara a los mismos participantes o unidades contra sí mismos en otro momento o condición.",
    example: "Medición antes y después de una intervención en el mismo grupo.",
    note: "Reduce variabilidad entre personas, pero requiere controlar efectos temporales."
  },
  aleatorizado: {
    label: "Aleatorizado",
    category: "Asignación",
    definition: "La asignación a intervención o control se realiza por azar.",
    example: "Ensayo clínico aleatorizado 1:1.",
    note: "Reduce sesgo de selección si está correctamente implementado."
  },
  noAleatorizado: {
    label: "No aleatorizado",
    category: "Asignación",
    definition: "La intervención o exposición no se asigna por azar.",
    example: "Comparación de grupos según tratamiento elegido por criterio clínico.",
    note: "Requiere controlar confusión por indicación."
  },
  clusters: {
    label: "Por clusters",
    category: "Asignación",
    definition: "La asignación se realiza por grupos, centros, comunidades o unidades organizacionales.",
    example: "Centros de atención primaria asignados a intervención o control.",
    note: "El análisis debe considerar correlación dentro de cada grupo."
  },
  crossover: {
    label: "Crossover",
    category: "Asignación",
    definition: "Los participantes reciben más de una intervención en secuencia, con comparación intraindividuo.",
    example: "Un paciente recibe tratamiento A y luego tratamiento B tras un período de lavado.",
    note: "Debe controlar arrastre de efecto entre períodos."
  },
  factorial: {
    label: "Factorial",
    category: "Asignación",
    definition: "Evalúa dos o más intervenciones o factores en combinaciones simultáneas.",
    example: "Diseño 2x2 para evaluar dieta y fármaco en paralelo.",
    note: "Permite estudiar efectos principales e interacciones."
  },
  abierto: {
    label: "Abierto",
    category: "Cegamiento",
    definition: "Participantes e investigadores conocen la intervención asignada.",
    example: "Ensayo pragmático abierto en atención primaria.",
    note: "Puede ser necesario, pero aumenta riesgo de sesgos de desempeño o medición."
  },
  simpleCiego: {
    label: "Simple ciego",
    category: "Cegamiento",
    definition: "Una de las partes, habitualmente el participante, desconoce la asignación.",
    example: "Participante desconoce si recibe intervención o control.",
    note: "Busca reducir sesgos de expectativa."
  },
  dobleCiego: {
    label: "Doble ciego",
    category: "Cegamiento",
    definition: "Participantes e investigadores/evaluadores desconocen la asignación.",
    example: "Ensayo farmacológico doble ciego.",
    note: "Reduce sesgos de desempeño y medición."
  },
  tripleCiego: {
    label: "Triple ciego",
    category: "Cegamiento",
    definition: "Participantes, equipo investigador/evaluador y analistas desconocen la asignación.",
    example: "Ensayo donde el análisis primario se realiza con grupos codificados.",
    note: "Exige planificación operativa y documentación estricta del desenmascaramiento."
  }
};

export const METHODOLOGY_GUIDE = {
  title: "Metodología de estudios científicos",
  subtitle: "Guía rápida para reconocer diseño, temporalidad, población, comparador y análisis.",
  intro: {
    title: "Cómo interpretar rápidamente un diseño",
    text:
      "Un estudio científico no se define por una sola etiqueta. Se clasifica combinando qué se hizo, cuándo se midió, sobre quiénes, con qué comparador y cómo se analizaron los datos.",
    cards: [
      {
        icon: "layers",
        title: "Qué tipo de evidencia es",
        text: "Primaria, secundaria, guía, consenso, implementación o economía de la salud."
      },
      {
        icon: "database",
        title: "Cómo se obtuvo la información",
        text: "Intervención, observación, registros, búsqueda sistemática, consenso o evaluación de programa."
      },
      {
        icon: "target",
        title: "Qué tan aplicable es",
        text: "Población, ámbito, centros, duración, desenlaces y limitaciones."
      }
    ]
  },
  navItems: [
    ["formula", "Fórmula"],
    ["differences", "Diferencias clave"],
    ["families", "Familias"],
    ["classifications", "Clasificaciones"],
    ["designs", "Diseños"],
    ["checklist", "Checklist"],
    ["measures", "Medidas"],
    ["reporting", "Guías"]
  ],
  formula: {
    steps: ["Diseño", "Objetivo", "Temporalidad", "Direccionalidad", "Centros", "Población", "Comparador", "Análisis"],
    example:
      "Observacional · Analítico · Longitudinal · Cohorte retrospectiva · Multicéntrico · Registros clínicos.",
    note: "Mientras más completa sea la descripción, más fácil será interpretar validez y aplicabilidad."
  },
  keyDifferences: [
    {
      title: "Prospectivo vs retrospectivo",
      left: ["Prospectivo", "Define seguimiento hacia adelante."],
      right: ["Retrospectivo", "Analiza datos ya ocurridos o registros históricos."]
    },
    {
      title: "Transversal vs longitudinal",
      left: ["Transversal", "Mide en un punto o período corto."],
      right: ["Longitudinal", "Observa cambios o desenlaces en el tiempo."]
    },
    {
      title: "Cohorte vs caso-control",
      left: ["Cohorte", "Parte de exposición o población y observa desenlaces."],
      right: ["Caso-control", "Parte del desenlace y compara exposiciones previas."]
    },
    {
      title: "Observacional vs experimental",
      left: ["Observacional", "El investigador no asigna intervención."],
      right: ["Experimental", "El investigador asigna intervención o estrategia."]
    },
    {
      title: "Revisión sistemática vs metaanálisis",
      left: ["Revisión sistemática", "Búsqueda y síntesis estructurada."],
      right: ["Metaanálisis", "Combinación estadística de resultados comparables."]
    },
    {
      title: "Unicéntrico vs multicéntrico",
      left: ["Unicéntrico", "Un solo centro."],
      right: ["Multicéntrico", "Dos o más centros o instituciones participantes."]
    }
  ],
  families: [
    {
      icon: "activity",
      title: "Estudios primarios",
      subtitle: "Generan datos originales.",
      items: [
        ["Observacionales", "El investigador observa, no interviene."],
        ["Experimentales", "El investigador asigna una intervención."],
        ["Cualitativos", "Exploran experiencias, significados o percepciones."],
        ["Mixtos", "Combinan datos cuantitativos y cualitativos."]
      ]
    },
    {
      icon: "files",
      title: "Estudios secundarios",
      subtitle: "Sintetizan o integran evidencia ya publicada.",
      items: [
        ["Revisión narrativa", "Síntesis amplia sin protocolo necesariamente explícito."],
        ["Revisión sistemática", "Búsqueda estructurada, criterios explícitos y síntesis reproducible."],
        ["Metaanálisis", "Combinación estadística de resultados comparables."],
        ["Scoping review", "Mapea evidencia disponible y brechas de conocimiento."],
        ["Umbrella review", "Sintetiza revisiones sistemáticas sobre una pregunta amplia."]
      ]
    }
  ],
  distinction: {
    title: "Revisión sistemática ≠ Metaanálisis",
    items: [
      ["Revisión sistemática", "Método de búsqueda y síntesis."],
      ["Metaanálisis", "Combinación estadística de resultados."]
    ]
  },
  classifications: [
    {
      title: "Por intervención",
      description: "Define si el investigador observa o asigna una estrategia.",
      terms: [
        { label: "Observacional", termKey: "observacional" },
        { label: "Experimental", termKey: "experimental" },
        { label: "Cuasi-experimental", termKey: "cuasiExperimental" }
      ]
    },
    {
      title: "Por objetivo",
      description: "Aclara qué pretende responder el estudio.",
      terms: [
        { label: "Descriptivo", termKey: "descriptivo" },
        { label: "Analítico", termKey: "analitico" },
        { label: "Diagnóstico", termKey: "diagnostico" },
        { label: "Pronóstico", termKey: "pronostico" },
        { label: "Terapéutico", termKey: "terapeutico" },
        { label: "Preventivo", termKey: "preventivo" },
        { label: "Económico", termKey: "economico" }
      ]
    },
    {
      title: "Por tiempo",
      description: "Ubica cuándo se recolectan o analizan los datos.",
      terms: [
        { label: "Prospectivo", termKey: "prospectivo" },
        { label: "Retrospectivo", termKey: "retrospectivo" },
        { label: "Ambispectivo", termKey: "ambispectivo" }
      ]
    },
    {
      title: "Por seguimiento",
      description: "Distingue medición puntual frente a evolución temporal.",
      terms: [
        { label: "Transversal", termKey: "transversal" },
        { label: "Longitudinal", termKey: "longitudinal" }
      ]
    },
    {
      title: "Por dirección",
      description: "Indica desde dónde se inicia la observación metodológica.",
      terms: [
        { label: "Cohorte", termKey: "cohorte" },
        { label: "Caso-control", termKey: "casoControl" },
        { label: "Transversal", termKey: "transversal" },
        { label: "Ecológico", termKey: "ecologico" }
      ]
    },
    {
      title: "Por centros",
      description: "Describe cuántos sitios o países participan.",
      terms: [
        { label: "Unicéntrico", termKey: "unicentrico" },
        { label: "Bicéntrico", termKey: "bicentrico" },
        { label: "Multicéntrico", termKey: "multicentrico" },
        { label: "Multinacional", termKey: "multinacional" }
      ]
    },
    {
      title: "Por comparador",
      description: "Explica contra qué se interpreta el efecto o resultado.",
      terms: [
        { label: "Sin control", termKey: "sinControl" },
        { label: "Placebo", termKey: "placebo" },
        { label: "Control activo", termKey: "controlActivo" },
        { label: "Histórico", termKey: "historico" },
        { label: "Autocontrolado", termKey: "autocontrolado" }
      ]
    },
    {
      title: "Por asignación",
      description: "Detalla cómo se distribuyen intervenciones o estrategias.",
      terms: [
        { label: "Aleatorizado", termKey: "aleatorizado" },
        { label: "No aleatorizado", termKey: "noAleatorizado" },
        { label: "Por clusters", termKey: "clusters" },
        { label: "Crossover", termKey: "crossover" },
        { label: "Factorial", termKey: "factorial" }
      ]
    },
    {
      title: "Por cegamiento",
      description: "Indica quién conoce o desconoce la asignación.",
      terms: [
        { label: "Abierto", termKey: "abierto" },
        { label: "Simple ciego", termKey: "simpleCiego" },
        { label: "Doble ciego", termKey: "dobleCiego" },
        { label: "Triple ciego", termKey: "tripleCiego" }
      ]
    }
  ],
  frequentDesigns: [
    {
      icon: "scan-line",
      title: "Transversal",
      text: "Mide exposición y desenlace en un momento.",
      badge: "Prevalencia"
    },
    {
      icon: "route",
      title: "Cohorte",
      text: "Parte de exposición o población y sigue desenlaces.",
      badge: "Riesgo e incidencia"
    },
    {
      icon: "search",
      title: "Caso-control",
      text: "Parte del desenlace y busca exposiciones previas.",
      badge: "Enfermedades raras"
    },
    {
      icon: "flask-conical",
      title: "Ensayo clínico",
      text: "Evalúa una intervención asignada por el investigador.",
      badge: "Intervención"
    },
    {
      icon: "repeat-2",
      title: "Cuasi-experimental",
      text: "Evalúa una intervención sin randomización estricta.",
      badge: "Antes-después"
    },
    {
      icon: "list-checks",
      title: "Revisión sistemática",
      text: "Sintetiza evidencia mediante búsqueda estructurada.",
      badge: "Síntesis"
    },
    {
      icon: "sigma",
      title: "Metaanálisis",
      text: "Combina estadísticamente resultados comparables.",
      badge: "Estadística combinada"
    }
  ],
  checklistGroups: [
    {
      title: "Pregunta y diseño",
      items: ["Pregunta de investigación", "Objetivo primario", "Diseño del estudio"]
    },
    {
      title: "Población y exposición",
      items: ["Población y ámbito", "Criterios de inclusión/exclusión", "Exposición o intervención", "Comparador"]
    },
    {
      title: "Medición y análisis",
      items: [
        "Desenlace primario/secundarios",
        "Variables y definiciones",
        "Recolección de datos",
        "Control de sesgos/confusores",
        "Plan estadístico"
      ]
    },
    {
      title: "Ética y trazabilidad",
      items: ["Tamaño muestral", "Aspectos éticos", "Registro o protocolo"]
    }
  ],
  commonMeasures: [
    ["Cohorte", "Riesgo relativo, Hazard ratio, Incidencia", "Riesgo/incidencia"],
    ["Caso-control", "Odds ratio", "Asociación con eventos raros"],
    ["Transversal", "Prevalencia, Razón de prevalencias", "Frecuencia"],
    ["Ensayo clínico", "Riesgo relativo, Diferencia absoluta, NNT", "Efecto de intervención"],
    ["Diagnóstico", "Sensibilidad, Especificidad, VPP, VPN, AUC", "Rendimiento diagnóstico"],
    ["Metaanálisis", "Efecto combinado, heterogeneidad, IC", "Síntesis estadística"]
  ],
  reportingGuidelines: [
    ["CONSORT", "Ensayos clínicos"],
    ["STROBE", "Observacionales"],
    ["PRISMA", "Revisiones sistemáticas/metaanálisis"],
    ["SPIRIT", "Protocolos de ensayos"],
    ["STARD", "Diagnóstico"],
    ["TRIPOD", "Modelos predictivos"],
    ["CARE", "Reportes de caso"],
    ["COREQ", "Cualitativos"],
    ["CHEERS", "Económicas"]
  ],
  closing: {
    icon: "shield-check",
    text: "Una buena metodología permite interpretar la validez, reproducibilidad y aplicabilidad de un estudio."
  }
};
