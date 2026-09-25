require('dotenv').config();
const { sql, poolPromise } = require('./db');

async function liberarCorreo() {
  try {
    const pool = await poolPromise;
    const miCorreo = 'ocruzp2@miumg.edu.gt';

    // 1. Buscar el carné al que quedó amarrado tu correo
    const busqueda = await pool.request()
      .input('correo', sql.NVarChar(150), miCorreo)
      .query('SELECT * FROM Estudiantes WHERE Correo = @correo');

    if (busqueda.recordset.length === 0) {
      console.log('Tu correo ya está libre, no tiene registros previos.');
      process.exit();
    }

    const carnetViejo = busqueda.recordset[0].Carnet;
    console.log(`Carné anterior encontrado: ${carnetViejo}`);

    // 2. Eliminar el detalle y maestro con ese carné
    const req = pool.request();
    req.input('carnet', sql.VarChar(25), carnetViejo);
    await req.query(`
      DELETE FROM EstudianteMisiones WHERE Carnet = @carnet;
      DELETE FROM Estudiantes WHERE Carnet = @carnet;
    `);

    console.log('Registro eliminado exitosamente. Tu correo ya está disponible.');
    process.exit();
  } catch (err) {
    console.error('Error al limpiar:', err.message);
    process.exit(1);
  }
}

liberarCorreo();