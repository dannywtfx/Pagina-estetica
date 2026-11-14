const API_URL = '/api';
let serviciosGlobales = [];
let descuentoActual = 0;
let nivelActual = 'Estándar';
let selectedTimeSlot = '';
let adminPinGuardado = '';

document.addEventListener('DOMContentLoaded', () => {
    cargarServicios();

    const dateInput = document.getElementById('appointmentDate');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.setAttribute('min', today);

        dateInput.addEventListener('change', async function () {
            const fechaSeleccionada = this.value;
            if (!fechaSeleccionada) return;

            try {
                const response = await fetch(`${API_URL}/citas-ocupadas?fecha=${fechaSeleccionada}`);
                const horasOcupadas = await response.json();

                document.querySelectorAll('.time-slot').forEach(slot => {
                    slot.classList.remove('disabled', 'selected');
                    const partes = slot.textContent.trim().split(' ');
                    const horaTexto = `${partes[0]} ${partes[1]}`;

                    if (horasOcupadas.includes(horaTexto)) {
                        slot.classList.add('disabled');
                        slot.innerHTML = `${horaTexto} (Ocupado)`;
                    } else {
                        slot.innerHTML = horaTexto;
                    }
                });
                selectedTimeSlot = '';
            } catch (error) {
                console.error('Error al consultar horarios ocupados:', error);
            }
        });
    }
});

// ==========================================
// CARGA DINÁMICA DE SERVICIOS (CON PRECIOS)
// ==========================================
async function cargarServicios() {
    try {
        const res = await fetch(`${API_URL}/servicios`);
        serviciosGlobales = await res.json();

        const grid = document.getElementById('servicesGrid');
        const select = document.getElementById('serviceSelect');
        const adminList = document.getElementById('adminServicesList');

        if (grid) grid.innerHTML = '';
        if (select) select.innerHTML = '<option value="">-- Elija un servicio --</option>';
        if (adminList) adminList.innerHTML = '';

        serviciosGlobales.forEach(s => {
            // 1. Tarjeta pública con el precio dinámico
            if (grid) {
                grid.innerHTML += `
                    <div class="service-card">
                        <h3>${s.nombre}</h3>
                        <p class="description">${s.descripcion || ''}</p>
                        <div class="price">$${Number(s.precio).toLocaleString('es-MX')} MXN</div>
                        <div class="duration">⏱ Duración: ${s.duracion} min</div>
                        <button class="btn-select" onclick="selectService('${s.id_servicios}')">Seleccionar</button>
                    </div>
                `;
            }

            // 2. Opción en el select de citas
            if (select) {
                select.innerHTML += `<option value="${s.id_servicios}">${s.nombre} ($${Number(s.precio).toFixed(2)})</option>`;
            }

            // 3. Fila en el panel de administración
            if (adminList) {
                adminList.innerHTML += `
                    <div class="admin-item">
                        <div>
                            <strong>${s.nombre}</strong> - $${Number(s.precio).toFixed(2)} (${s.duracion} min)
                            <p class="small-desc">${s.descripcion || ''}</p>
                        </div>
                        <div class="admin-item-btns">
                            <button type="button" class="btn-edit" onclick="prepararEdicion(${s.id_servicios})">Editar</button>
                            <button type="button" class="btn-delete" onclick="eliminarServicio(${s.id_servicios})">Eliminar</button>
                        </div>
                    </div>
                `;
            }
        });
    } catch (error) {
        console.error('Error cargando servicios:', error);
    }
}

// ==========================================
// MEMBRESÍAS Y CÁLCULO DE DESCUENTO
// ==========================================
async function verificarMembresia() {
    const telefonoInput = document.getElementById('clientPhone');
    const banner = document.getElementById('membershipBanner');
    if (!telefonoInput || !banner) return;

    const telefono = telefonoInput.value.trim();

    if (telefono.length < 8) {
        banner.style.display = 'none';
        descuentoActual = 0;
        nivelActual = 'Estándar';
        actualizarResumenPrecio();
        return;
    }

    try {
        const res = await fetch(`${API_URL}/clientes/membresia/${telefono}`);
        const data = await res.json();

        descuentoActual = data.descuento;
        nivelActual = data.nivel;
        banner.style.display = 'block';

        if (data.existe) {
            const nameInput = document.getElementById('clientName');
            if (nameInput && !nameInput.value && data.nombre) nameInput.value = data.nombre;

            const porcentaje = Math.round(data.descuento * 100);
            banner.className = `membership-banner banner-${data.nivel.toLowerCase()}`;
            banner.innerHTML = `✨ ¡Hola de nuevo! Tienes <strong>Membresía ${data.nivel}</strong> (${data.visitas} visitas). Descuento activo: <strong>${porcentaje}%</strong>.`;
        } else {
            banner.className = 'membership-banner banner-estándar';
            banner.innerHTML = `👋 Cliente nuevo: Esta será tu visita #1. ¡Acumula 3 visitas para obtener 10% de descuento!`;
        }
        actualizarResumenPrecio();
    } catch (error) {
        console.error('Error verificando membresía:', error);
    }
}

function actualizarResumenPrecio() {
    const serviceSelect = document.getElementById('serviceSelect');
    const summary = document.getElementById('priceSummary');
    if (!serviceSelect || !summary) return;

    const idServicio = serviceSelect.value;

    if (!idServicio) {
        summary.style.display = 'none';
        return;
    }

    const servicio = serviciosGlobales.find(s => String(s.id_servicios) === String(idServicio));
    if (!servicio) return;

    const precioBase = Number(servicio.precio);
    const ahorro = precioBase * descuentoActual;
    const total = precioBase - ahorro;

    summary.style.display = 'block';
    if (descuentoActual > 0) {
        summary.innerHTML = `
            Precio regular: <del>$${precioBase.toFixed(2)} MXN</del> | 
            Descuento Membresía ${nivelActual} (-${Math.round(descuentoActual * 100)}%): <strong>-$${ahorro.toFixed(2)}</strong><br>
            <span class="final-price">Total a pagar en sucursal: $${total.toFixed(2)} MXN</span>
        `;
    } else {
        summary.innerHTML = `<span class="final-price">Total a pagar en sucursal: $${precioBase.toFixed(2)} MXN</span>`;
    }
}

// ==========================================
// RESERVACIÓN DE CITAS
// ==========================================
function selectService(serviceId) {
    const serviceSelect = document.getElementById('serviceSelect');
    if (serviceSelect) {
        serviceSelect.value = serviceId;
        actualizarResumenPrecio();
        const citasSec = document.getElementById('citas');
        if (citasSec) citasSec.scrollIntoView({ behavior: 'smooth' });
    }
}

function selectTime(element) {
    if (element.classList.contains('disabled')) return;
    document.querySelectorAll('.time-slot').forEach(slot => slot.classList.remove('selected'));
    element.classList.add('selected');
    const partes = element.innerText.split(' ');
    selectedTimeSlot = `${partes[0]} ${partes[1]}`;
}

async function confirmBooking(event) {
    event.preventDefault();

    const nombre = document.getElementById('clientName').value;
    const telefono = document.getElementById('clientPhone').value;
    const id_servicio = document.getElementById('serviceSelect').value;
    const fecha = document.getElementById('appointmentDate').value;

    if (!selectedTimeSlot) {
        alert('Por favor selecciona un horario disponible.');
        return;
    }

    const servicio = serviciosGlobales.find(s => String(s.id_servicios) === String(id_servicio));
    const duracion = servicio ? Number(servicio.duracion) : 60;

    const timeFormatted = convertirA24Horas(selectedTimeSlot);
    const fecha_inicio = `${fecha} ${timeFormatted}`;
    const fecha_fin = calcularFechaFin(fecha_inicio, duracion);

    try {
        const response = await fetch(`${API_URL}/citas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, telefono, id_servicio, fecha_inicio, fecha_fin })
        });

        const data = await response.json();

        if (response.ok) {
            alert(
                `¡Gracias ${nombre}!\n\n` +
                `Tu cita ha sido registrada.\n` +
                `Total a pagar: $${data.precio_final} MXN (Descuento aplicado: ${data.descuento_aplicado}%)\n` +
                `Visitas acumuladas: ${data.total_visitas} | Tu nivel actual: ${data.nuevo_nivel}`
            );

            document.getElementById('bookingForm').reset();
            document.getElementById('membershipBanner').style.display = 'none';
            document.getElementById('priceSummary').style.display = 'none';
            document.querySelectorAll('.time-slot').forEach(slot => {
                slot.classList.remove('selected', 'disabled');
                const partes = slot.innerText.split(' ');
                slot.innerText = `${partes[0]} ${partes[1]}`;
            });
            selectedTimeSlot = '';
            descuentoActual = 0;
        } else {
            alert('Error al registrar la cita: ' + data.error);
        }
    } catch (error) {
        console.error('Error de red:', error);
        alert('No se pudo conectar con el servidor.');
    }
}

// ==========================================
// PANEL DE ADMINISTRACIÓN DEL DUEÑO
// ==========================================
function abrirPanelAdmin(e) {
    e.preventDefault();
    if (!adminPinGuardado) {
        const pin = prompt('Ingresa el PIN de administrador de Amatista:');
        if (!pin) return;
        adminPinGuardado = pin;
    }
    const modal = document.getElementById('adminModal');
    if (modal) modal.style.display = 'flex';
}

function cerrarPanelAdmin() {
    const modal = document.getElementById('adminModal');
    if (modal) modal.style.display = 'none';
    resetAdminForm();
}

function prepararEdicion(id) {
    const s = serviciosGlobales.find(item => item.id_servicios === id);
    if (!s) return;

    document.getElementById('editServiceId').value = s.id_servicios;
    document.getElementById('adminServiceName').value = s.nombre;
    document.getElementById('adminServiceDesc').value = s.descripcion || '';
    document.getElementById('adminServicePrice').value = s.precio;
    document.getElementById('adminServiceDuration').value = s.duracion;

    document.getElementById('btnSaveService').innerText = 'Guardar Cambios';
    document.getElementById('btnCancelEdit').style.display = 'inline-block';
}

function resetAdminForm() {
    document.getElementById('adminServiceForm').reset();
    document.getElementById('editServiceId').value = '';
    document.getElementById('btnSaveService').innerText = 'Agregar Servicio';
    document.getElementById('btnCancelEdit').style.display = 'none';
}

async function guardarServicio(e) {
    e.preventDefault();
    const id = document.getElementById('editServiceId').value;
    const payload = {
        pin: adminPinGuardado,
        nombre: document.getElementById('adminServiceName').value,
        descripcion: document.getElementById('adminServiceDesc').value,
        precio: document.getElementById('adminServicePrice').value,
        duracion: document.getElementById('adminServiceDuration').value
    };

    const url = id ? `${API_URL}/servicios/${id}` : `${API_URL}/servicios`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok) {
        alert(data.message);
        resetAdminForm();
        cargarServicios();
    } else {
        alert('Error: ' + data.error);
        if (res.status === 401) adminPinGuardado = '';
    }
}

async function eliminarServicio(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar este servicio?')) return;

    const res = await fetch(`${API_URL}/servicios/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: adminPinGuardado })
    });

    const data = await res.json();
    if (res.ok) {
        alert(data.message);
        cargarServicios();
    } else {
        alert('Error: ' + data.error);
        if (res.status === 401) adminPinGuardado = '';
    }
}

// Funciones auxiliares de tiempo
function convertirA24Horas(timeStr) {
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':');
    if (hours === '12') {
        if (modifier === 'AM') hours = '00';
    } else if (modifier === 'PM') {
        hours = String(parseInt(hours, 10) + 12);
    }
    return `${String(hours).padStart(2, '0')}:${minutes}:00`;
}

function calcularFechaFin(fechaInicioStr, minutosDuracion) {
    const fecha = new Date(fechaInicioStr);
    fecha.setMinutes(fecha.getMinutes() + minutosDuracion);
    const pad = n => String(n).padStart(2, '0');
    return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())} ${pad(fecha.getHours())}:${pad(fecha.getMinutes())}:00`;
}