const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// PIN para el dueño de la estética
const ADMIN_PIN = 'amatista2026';

// Configuración de la conexión a Neon DB (PostgreSQL)
// Utiliza la variable de entorno DATABASE_URL que configurarás en tu servicio en la nube (ej. Render)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Error al conectar a Neon DB:', err.stack);
        return;
    }
    console.log('Conectado exitosamente a Neon DB (PostgreSQL)');
    release();
});

pool.on('error', (err) => {
    console.error('Error inesperado en el cliente de la base de datos:', err);
});

// Función auxiliar para determinar nivel y porcentaje de descuento
function calcularMembresia(visitas) {
    if (visitas >= 6) return { nivel: 'Oro', descuento: 0.20 };
    if (visitas >= 3) return { nivel: 'Plata', descuento: 0.10 };
    return { nivel: 'Estándar', descuento: 0 };
}

// ==========================================
// RUTAS DE SERVICIOS (PÚBLICAS Y ADMIN)
// ==========================================

app.get('/api/servicios', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM servicios');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/servicios', async (req, res) => {
    const { pin, nombre, descripcion, precio, duracion } = req.body;
    if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'PIN de administrador incorrecto' });

    try {
        const sql = 'INSERT INTO servicios (nombre, descripcion, precio, duracion) VALUES ($1, $2, $3, $4) RETURNING id_servicios';
        const result = await pool.query(sql, [nombre, descripcion, precio, duracion]);
        res.status(201).json({ message: 'Servicio agregado', id: result.rows[0].id_servicios });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/servicios/:id', async (req, res) => {
    const { pin, nombre, descripcion, precio, duracion } = req.body;
    const { id } = req.params;
    if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'PIN de administrador incorrecto' });

    try {
        const sql = 'UPDATE servicios SET nombre = $1, descripcion = $2, precio = $3, duracion = $4 WHERE id_servicios = $5';
        await pool.query(sql, [nombre, descripcion, precio, duracion, id]);
        res.json({ message: 'Servicio actualizado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/servicios/:id', async (req, res) => {
    const { pin } = req.body;
    const { id } = req.params;
    if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'PIN de administrador incorrecto' });

    try {
        await pool.query('DELETE FROM servicios WHERE id_servicios = $1', [id]);
        res.json({ message: 'Servicio eliminado' });
    } catch (err) {
        res.status(500).json({ error: 'No se puede eliminar un servicio que ya tiene citas registradas.' });
    }
});

// ==========================================
// RUTAS DE MEMBRESÍAS Y CITAS
// ==========================================

app.get('/api/clientes/membresia/:telefono', async (req, res) => {
    const { telefono } = req.params;
    try {
        const result = await pool.query('SELECT nombre, total_visitas, nivel_membresia FROM clientes WHERE telefono = $1', [telefono]);
        if (result.rows.length === 0) {
            return res.json({ existe: false, nivel: 'Estándar', descuento: 0, visitas: 0 });
        }
        const cliente = result.rows[0];
        const info = calcularMembresia(cliente.total_visitas);
        res.json({
            existe: true,
            nombre: cliente.nombre,
            visitas: cliente.total_visitas,
            nivel: info.nivel,
            descuento: info.descuento
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/citas-ocupadas', async (req, res) => {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Se requiere la fecha' });

    try {
        // En PostgreSQL usamos TO_CHAR para formatear la hora de forma equivalente
        const sql = "SELECT TO_CHAR(fecha_hora_inicio, 'HH12:MI AM') AS hora_ocupada FROM citas WHERE DATE(fecha_hora_inicio) = $1";
        const result = await pool.query(sql, [fecha]);
        res.json(result.rows.map(row => row.hora_ocupada));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/citas', async (req, res) => {
    const { nombre, telefono, id_servicio, fecha_inicio, fecha_fin } = req.body;

    if (!nombre || !telefono || !id_servicio || !fecha_inicio) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para la cita' });
    }

    try {
        const servicioResult = await pool.query('SELECT nombre, precio FROM servicios WHERE id_servicios = $1', [id_servicio]);
        if (servicioResult.rows.length === 0) {
            return res.status(400).json({ error: 'El servicio seleccionado no es válido' });
        }

        const servicio = servicioResult.rows[0];

        const clienteResult = await pool.query('SELECT id_cliente, total_visitas FROM clientes WHERE telefono = $1', [telefono]);

        const visitasPrevias = clienteResult.rows.length > 0 ? clienteResult.rows[0].total_visitas : 0;
        const membresiaActual = calcularMembresia(visitasPrevias);
        const precioFinal = servicio.precio * (1 - membresiaActual.descuento);

        const nuevasVisitas = visitasPrevias + 1;
        const nuevaMembresia = calcularMembresia(nuevasVisitas).nivel;

        let idCliente;

        if (clienteResult.rows.length > 0) {
            idCliente = clienteResult.rows[0].id_cliente;
            const sqlUpdate = 'UPDATE clientes SET nombre = $1, motivo = $2, total_visitas = $3, nivel_membresia = $4 WHERE id_cliente = $5';
            await pool.query(sqlUpdate, [nombre, servicio.nombre, nuevasVisitas, nuevaMembresia, idCliente]);
        } else {
            const sqlInsert = 'INSERT INTO clientes (nombre, telefono, motivo, total_visitas, nivel_membresia) VALUES ($1, $2, $3, 1, $4) RETURNING id_cliente';
            const insertRes = await pool.query(sqlInsert, [nombre, telefono, servicio.nombre, nuevaMembresia]);
            idCliente = insertRes.rows[0].id_cliente;
        }

        const sqlCita = `
            INSERT INTO citas (id_cliente, id_servicio, fecha_hora_inicio, fecha_hora_fin, estado, precio_final) 
            VALUES ($1, $2, $3, $4, 'Pendiente', $5) RETURNING id_citas
        `;
        const citaRes = await pool.query(sqlCita, [idCliente, id_servicio, fecha_inicio, fecha_fin, precioFinal]);

        res.status(201).json({
            message: 'Cita registrada con éxito',
            id_cita: citaRes.rows[0].id_citas,
            nivel_aplicado: membresiaActual.nivel,
            descuento_aplicado: membresiaActual.descuento * 100,
            precio_final: Number(precioFinal).toFixed(2),
            nuevo_nivel: nuevaMembresia,
            total_visitas: nuevasVisitas
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});