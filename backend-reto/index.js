const express = require('express');
const cors = require('cors');
const { sql, poolPromise } = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------
// 1. GET /api/misiones -> Consultar catálogo
// ---------------------------------------------------------------------
app.get('/api/misiones', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM Misiones ORDER BY MisionID ASC');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar misiones', detalle: err.message });
  }
});

// ---------------------------------------------------------------------
// 2. GET /api/estudiantes -> Listar estudiantes y sus misiones con estado
// ---------------------------------------------------------------------
app.get('/api/estudiantes', async (req, res) => {
  try {
    const pool = await poolPromise;
    const query = `
      SELECT 
        e.Carnet, e.Nombre, e.Correo,
        em.MisionID, m.Nombre AS MisionNombre, em.Estado, em.FechaRegistro
      FROM Estudiantes e
      LEFT JOIN EstudianteMisiones em ON e.Carnet = em.Carnet
      LEFT JOIN Misiones m ON em.MisionID = m.MisionID
      ORDER BY e.Carnet, em.MisionID ASC
    `;
    const result = await pool.request().query(query);

    // Agrupar por estudiante
    const agrupado = {};
    result.recordset.forEach(row => {
      if (!agrupado[row.Carnet]) {
        agrupado[row.Carnet] = {
          carnet: row.Carnet,
          nombre: row.Nombre,
          correo: row.Correo,
          misiones: []
        };
      }
      if (row.MisionID) {
        agrupado[row.Carnet].misiones.push({
          misionId: row.MisionID,
          nombre: row.MisionNombre,
          estado: !!row.Estado,
          fechaRegistro: row.FechaRegistro
        });
      }
    });

    res.json(Object.values(agrupado));
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estudiantes', detalle: err.message });
  }
});

// ---------------------------------------------------------------------
// 3. POST /api/registro -> Procesar Maestro-Detalle con transacción
// ---------------------------------------------------------------------
app.post('/api/registro', async (req, res) => {
  const { maestro, detalle } = req.body;

  if (!maestro || !maestro.carnet || !maestro.nombre || !maestro.correo) {
    return res.status(400).json({ error: 'El objeto maestro (carnet, nombre, correo) es obligatorio.' });
  }
  if (!Array.isArray(detalle)) {
    return res.status(400).json({ error: 'El detalle debe ser una lista de misiones.' });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    // A. Validar que todos los misionId existan en Misiones
    const misionesValidasResult = await transaction.request()
      .query('SELECT MisionID FROM Misiones');
    const idsExistentes = new Set(misionesValidasResult.recordset.map(m => m.MisionID));

    for (const item of detalle) {
      if (!idsExistentes.has(item.misionId)) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Error de referencia',
          mensaje: `La misionId ${item.misionId} no existe en el catálogo de Misiones.`
        });
      }
    }

    // B. Maestro: Insertar o actualizar Estudiante
    const estudianteReq = transaction.request();
    estudianteReq.input('carnet', sql.VarChar(25), maestro.carnet);
    estudianteReq.input('nombre', sql.NVarChar(150), maestro.nombre);
    estudianteReq.input('correo', sql.NVarChar(150), maestro.correo);

    await estudianteReq.query(`
      IF EXISTS (SELECT 1 FROM Estudiantes WHERE Carnet = @carnet)
      BEGIN
        UPDATE Estudiantes 
        SET Nombre = @nombre, Correo = @correo 
        WHERE Carnet = @carnet;
      END
      ELSE
      BEGIN
        INSERT INTO Estudiantes (Carnet, Nombre, Correo) 
        VALUES (@carnet, @nombre, @correo);
      END
    `);

    // C. Detalle: Insertar o actualizar cada misión del estudiante
    for (const item of detalle) {
      const misionReq = transaction.request();
      misionReq.input('carnet', sql.VarChar(25), maestro.carnet);
      misionReq.input('misionId', sql.Int, item.misionId);
      misionReq.input('estado', sql.Bit, item.estado ? 1 : 0);

      await misionReq.query(`
        IF EXISTS (SELECT 1 FROM EstudianteMisiones WHERE Carnet = @carnet AND MisionID = @misionId)
        BEGIN
          UPDATE EstudianteMisiones 
          SET Estado = @estado, FechaRegistro = GETDATE()
          WHERE Carnet = @carnet AND MisionID = @misionId;
        END
        ELSE
        BEGIN
          INSERT INTO EstudianteMisiones (Carnet, MisionID, Estado, FechaRegistro)
          VALUES (@carnet, @misionId, @estado, GETDATE());
        END
      `);
    }

    await transaction.commit();
    res.json({
      mensaje: 'Registro procesado exitosamente.',
      carnet: maestro.carnet,
      misionesProcesadas: detalle.length
    });

  } catch (err) {
    if (transaction) await transaction.rollback();
    res.status(500).json({ error: 'Error al procesar registro', detalle: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API corriendo en puerto ${PORT}`));