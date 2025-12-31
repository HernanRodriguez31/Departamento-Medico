const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccountPath =
    process.env.SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!serviceAccountPath) {
    throw new Error(
        "Missing service account credentials. Set SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS to the JSON key path."
    );
}

const resolvedPath = path.resolve(serviceAccountPath);

if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Service account file not found: ${resolvedPath}`);
}

const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

// Inicializamos Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

// LISTA COMPLETA DE MÉDICOS (33 usuarios)
const medicos = [
    { nombre: "Leila Cura", id: "LCura", email: "LCura@pan-energy.com", dni: "11450771", puesto: "Directora del Departamento Medico - CEO de Brisa - Gerente de Salud de PAE", unidad: "", gestion: "Upstream PAE - Downstram PAE - Salud Ocupacional MPSA/FSE" },
    { nombre: "Gustavo Silva", id: "GSilva", email: "GSilva@pan-energy.com", dni: "27193717", puesto: "Líder de Salud de PAE", unidad: "Upstream", gestion: "Golfo San Jorge - Neuquén - Acambuco" },
    { nombre: "Juan Martín Azcárate", id: "JAzcarate", email: "JAzcarate@pan-energy.com", dni: "28796725", puesto: "Líder de Salud de PAE", unidad: "Downstream", gestion: "Edificio Av. Alem 1110 - Refinería Campana - CORS." },
    { nombre: "Leandro Medina", id: "LMedina", email: "leandro.medina@manpetrol.com", dni: "29952925", puesto: "Líder de Salud de MPSA/FSE", unidad: "Upstream", gestion: "Golfo San Jorge - Neuquén" },
    { nombre: "Juan Maurino", id: "JMaurino", email: "JMaurino@pan-energy.com", dni: "30638318", puesto: "Coordinador Médico", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Braian Salas", id: "BSalas", email: "BSalas@pan-energy.com", dni: "37604393", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Gabriel Medina", id: "GMedina", email: "GMedinaSanchez@pan-energy.com", dni: "27142732", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Pablo Mayo", id: "PMayo", email: "PMayo@pan-energy.com", dni: "24283130", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Marcelo Calvo", id: "MCalvo", email: "MCalvoGil@pan-energy.com", dni: "34062301", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Verónica Castro", id: "VCastro", email: "MVCastro@pan-energy.com", dni: "36092620", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Santiago González Calcagno", id: "SGonzalezCalcagno", email: "SGonzalezCalcagno@pan-energy.com", dni: "34435257", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Gastón Castellan", id: "GCastellan", email: "GCastellan@pan-energy.com", dni: "34686414", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Paula Fernández", id: "PFernandez", email: "PVFernandez@pan-energy.com", dni: "38415437", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Edgar Jerez", id: "EJerez", email: "EJerez@pan-energy.com", dni: "29255962", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Francisco Bustos", id: "FBustos", email: "FBustos@pan-energy.com", dni: "94026623", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Neuquén" },
    { nombre: "Roberto Sabha", id: "RSabha", email: "RSabha@pan-energy.com", dni: "25437004", puesto: "Coordinador Médico", unidad: "Upstream", gestion: "Acambuco" },
    { nombre: "Mario Bianchi", id: "MBianchi", email: "MBianchi@pan-energy.com", dni: "29391985", puesto: "Coordinador Médico", unidad: "Downstream", gestion: "Edificio Av. Alem 1110 - Refinería Campana - CORS." },
    { nombre: "José Carlini", id: "JCarlini", email: "JCarlini@pan-energy.com", dni: "30834246", puesto: "Medico de CORS", unidad: "Downstream", gestion: "CORS" },
    { nombre: "Betina Robledo", id: "BRobledo", email: "MBRobledo@pan-energy.com", dni: "31409291", puesto: "Médica en Refinería Campana", unidad: "Downstream", gestion: "Refinería Campana" },
    { nombre: "Willie Billie Mateo", id: "MWilleBille", email: "mateo.willebille@manpetrol.com", dni: "26244099", puesto: "Medico Base, Edificio Manpetrol", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Hernán Rodríguez", id: "HRodriguez", email: "HRodriguez@pan-energy.com", dni: "31183328", puesto: "Coordinador Médico", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Sergio Aciar", id: "SAciar", email: "SAciar@pan-energy.com", dni: "23735739", puesto: "Coordinador Médico", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Adriane Dal Mas", id: "ADalMas", email: "ADalMas@pan-energy.com", dni: "94847834", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Arquimedes Pedraz", id: "APedraz", email: "APedraz@pan-energy.com", dni: "27038475", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Alberto Bartra", id: "ABartra", email: "ABartraCrovi@pan-energy.com", dni: "18780750", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Marcelo Rosales", id: "MRosales", email: "MRosales@pan-energy.com", dni: "22631212", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Fernando Mazzarelli", id: "GMazzarelli", email: "GMazzarelli@pan-energy.com", dni: "24416639", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Roque Ricco", id: "RRicco", email: "RRicco@pan-energy.com", dni: "20454491", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Cristian Ruben", id: "CRuben", email: "CRuben@pan-energy.com", dni: "28343675", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Juan Gandarillas", id: "JGandarillas", email: "JGandarillas@pan-energy.com", dni: "29182988", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Emmanuel Rivas", id: "ERivas", email: "ENRivas@pan-energy.com", dni: "38550627", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Maximiliano Toledo", id: "MToledo", email: "MToledo@pan-energy.com", dni: "30632740", puesto: "Médico en Yacimiento", unidad: "Upstream", gestion: "Golfo San Jorge" },
    { nombre: "Fiorella Cappelli", id: "FCappelli", email: "FRCappelli@pan-energy.com", dni: "38517068", puesto: "Médico en Edificio Democracia", unidad: "Upstream", gestion: "Golfo San Jorge" }
];

async function cargarUsuarios() {
    console.log(`🚀 Iniciando carga de ${medicos.length} médicos...`);

    for (const medico of medicos) {
        try {
            const passwordStr = String(medico.dni);

            // 1. Crear usuario en Authentication
            const userRecord = await auth.createUser({
                uid: medico.id,
                email: medico.email,
                password: passwordStr,
                displayName: medico.nombre,
            });

            console.log(`✅ Auth creado: ${medico.nombre}`);

            // 2. Crear documento en Firestore (Colección "usuarios")
            await db.collection("usuarios").doc(userRecord.uid).set({
                nombre: medico.nombre,
                email: medico.email,
                puesto: medico.puesto,
                unidadNegocio: medico.unidad,
                unidadGestion: medico.gestion,
                rol: "medico",
                fechaCreacion: new Date(),
                estado: "offline"
            });

            console.log(`   📄 Perfil Firestore creado.`);

        } catch (error) {
            if (error.code === 'auth/uid-already-exists') {
                console.log(`⚠️ El usuario ${medico.nombre} ya existía. Actualizando datos...`);
                // Si ya existe, actualizamos solo Firestore para asegurar que los datos estén bien
                await db.collection("usuarios").doc(medico.id).set({
                    nombre: medico.nombre,
                    email: medico.email,
                    puesto: medico.puesto,
                    unidadNegocio: medico.unidad,
                    unidadGestion: medico.gestion,
                    rol: "medico"
                }, { merge: true });
            } else {
                console.error(`❌ Error con ${medico.nombre}:`, error);
            }
        }
    }
    console.log("🏁 Carga finalizada.");
}

cargarUsuarios();
