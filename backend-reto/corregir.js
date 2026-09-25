const { sql, poolPromise } = require('./db');

async function corregirRegistro() {
  try {
    const pool = await poolPromise;
    const miCorreo = 'ocruzp2@miumg.edu.gt';
    const miCarnetReal = '1890-23-5704'; 

    // 1. Ver qué carné tiene actualmente asignado tu correo
    const buscar = await pool.request()
      .input('correo', sql.NVarChar(150), miCorreo)
      .query('SELECT * FROM Estudiantes WHERE Correo = @correo');

    if (buscar.recordset.length === 0) {
      console.log('No se encontró ningún estudiante con ese correo.');
      process.exit();
    }

    const carnetViejo = buscar.recordset[0].Carnet;
    console.log(`Tu correo está asociado al carné viejo: "${carnetViejo}". Se cambiará a: "${miCarnetReal}"`);

    // 2. Transacción para actualizar las referencias en EstudianteMisiones y Estudiantes
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    // Actualizar primero en detalle si existieran misiones asociadas
    const reqDetalle = transaction.request();
    reqDetalle.input('carnetViejo', sql.VarChar(25), carnetViejo);
    reqDetalle.input('carnetReal', sql.VarChar(25), miCarnetReal);
    await reqDetalle.query('DELETE FROM EstudianteMisiones WHERE Carnet = @carnetViejo');

    // Borrar el registro con el carné incorrecto para liberarlo
    const reqDelete = transaction.request();
    reqDelete.input('carnetViejo', sql.VarChar(25), carnetViejo);
    await reqDelete.query('DELETE FROM Estudiantes WHERE Carnet = @carnetViejo');

    await transaction.commit();
    console.log('Registro anterior eliminado correctamente. Ahora puedes registrar tus datos limpios.');
    process.exit();
  } catch (err) {
    console.error('Error al corregir:', err.message);
    process.exit(1);
  }
}

corregirRegistro();