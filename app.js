// Configuration
const CONFIG = {
    BASE_URL: 'https://raw.githubusercontent.com/JSebastianIEU/madrid_traffic_map/main/',
    MAX_ZOOM: 20,
    INITIAL_ZOOM: 14,
    BATCH_SIZE: 1000,
    BATCH_DELAY: 50,
    ICON_SIZE: [28, 28],
    ICON_ANCHOR: [14, 28],
    COLORS: {
        'Traffic Lights': '#ff4757',
        'Streetlights': '#ffa502',
        'Acoustic Signals': '#6c5ce7'
    },
    DATASETS: [
        { 
            name: 'Traffic Lights',
            file: 'trafic.csv',
            icon: 'icons/traffic-lights.png',
            coordFields: ['Longitude', 'Latitude']
        },
        {
            name: 'Streetlights',
            file: 'lamps.csv',
            icon: 'icons/streetlighs.png',
            coordFields: ['Longitude', 'Latitude']
        },
        {
            name: 'Acoustic Signals',
            file: 'acustic.csv',
            icon: 'icons/acoustic-signals.png',
            coordFields: ['Longitude', 'Latitude']
        }
    ]
};

// State Management
let map;
let markersCluster;
let districtsLayer;
const activeFilters = {
    categories: new Set(),
    districts: new Set()
};
const markersCache = new Map();

// Madrid Districts GeoJSON Structure
let madridDistricts;

// Base Map Configuration
const baseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB',
    maxZoom: 20,
    noWrap: true
});

// Label Layers
const streetLabelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_only_labels/{z}/{x}/{y}{r}.png');
const districtLabelsLayer = L.layerGroup();

// Modificar la función initMap
async function initMap() {
    try {
        updateLoadingScreen('Initializing base map...');
        showLoadingProgress(10);
        
        map = L.map('map', {
            maxZoom: CONFIG.MAX_ZOOM,
            minZoom: 12,
            preferCanvas: true,
            layers: [baseLayer]
        }).setView([40.4168, -3.7038], CONFIG.INITIAL_ZOOM);

        updateLoadingScreen('Loading districts...');
        showLoadingProgress(30);

        const districtsResponse = await fetch(`${CONFIG.BASE_URL}madrid-districts.geojson`);
        if (!districtsResponse.ok) throw new Error(`HTTP error! status: ${districtsResponse.status}`);
        madridDistricts = await districtsResponse.json();

        updateLoadingScreen('Initializing markers...');
        showLoadingProgress(50);

        markersCluster = L.markerClusterGroup({
            chunkedLoading: true,
            chunkInterval: CONFIG.BATCH_SIZE,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            disableClusteringAtZoom: 18,
            maxClusterRadius: 50
        });
        map.addLayer(markersCluster);

        updateLoadingScreen('Loading data...');
        showLoadingProgress(70);

        await loadData();
        
        updateLoadingScreen('Finalizing...');
        showLoadingProgress(90);

        initFilters();
        updateStatistics();
        
    } catch (error) {
        console.error('Critical initialization error:', error);
        showError(`Fatal error: ${error.message}`);
    } finally {
        document.querySelector('.loading-overlay').classList.add('hidden');
        showLoadingProgress(100);
    }
}

async function loadData() {
    try {
        let totalRows = 0;
        let processedRows = 0;
        let invalidRows = 0;
        
        // Contar filas totales
        for (const dataset of CONFIG.DATASETS) {
            const response = await fetch(`${CONFIG.BASE_URL}${dataset.file}`);
            const csvData = await response.text();
            
            const results = await new Promise((resolve, reject) => {
                Papa.parse(csvData, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    worker: true,
                    complete: (results) => resolve(results),
                    error: (err) => reject(err)
                });
            });

            totalRows += results.data.length;
        }

        // Procesar datos
        for (const dataset of CONFIG.DATASETS) {
            updateLoadingScreen(`Loading ${dataset.name}...`);
            
            const response = await fetch(`${CONFIG.BASE_URL}${dataset.file}`);
            const csvData = await response.text();
            
            const results = await new Promise((resolve, reject) => {
                Papa.parse(csvData, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    worker: true,
                    complete: (results) => resolve(results),
                    error: (err) => reject(err)
                });
            });

            const batchMarkers = [];
            for (const row of results.data) {
                try {
                    // Validar estructura de la fila
                    if (!validateRow(row, dataset)) {
                        invalidRows++;
                        continue;
                    }
            
                    const lng = parseFloat(row[dataset.coordFields[0]]);
                    const lat = parseFloat(row[dataset.coordFields[1]]);
                    
                    if (!validateCoordinates(lng, lat)) {
                        invalidRows++;
                        continue;
                    }

                    const marker = L.marker([lat, lng], {
                        icon: L.icon({
                            iconUrl: dataset.icon,
                            iconSize: CONFIG.ICON_SIZE,
                            iconAnchor: CONFIG.ICON_ANCHOR
                        }),
                        properties: {
                            category: dataset.name,
                            district: normalizeDistrict(row.district || ''),
                            type: row.type || 'N/A',
                            id: row.id || 'N/A',
                            address: row.address || 'N/A'
                        }
                    }).bindPopup(createPopupContent);

                    marker.on('mouseover', function() { this.openPopup(); });
                    marker.on('mouseout', function() { this.closePopup(); });

                    batchMarkers.push(marker);
                    markersCache.set(marker._leaflet_id, marker);
                    processedRows++;

                    // Actualizar progreso
                    if (processedRows % 100 === 0) {
                        const progress = Math.round((processedRows / totalRows) * 100);
                        showLoadingProgress(70 + (progress * 0.3));
                    }
                } catch (error) {
                    console.warn('Error processing row:', row, error);
                    invalidRows++;
                }
            }
            
            markersCluster.addLayers(batchMarkers);
        }

        console.log(`Data loading complete. Processed: ${processedRows}, Invalid: ${invalidRows}`);
        if (invalidRows > 0) {
            showError(`${invalidRows} invalid rows were skipped. Check console for details.`);
        }

    } catch (error) {
        console.error('Data loading failed:', error);
        showError(`Data error: ${error.message}`);
        throw error;
    }
}
// Filter System
function initFilters() {
    // Categories
    const categoryContainer = document.getElementById('category-filters');
    categoryContainer.innerHTML = CONFIG.DATASETS.map(dataset => `
        <div class="filter-item">
            <label>
                <input type="checkbox" data-category="${dataset.name}" checked>
                ${dataset.name}
            </label>
        </div>
    `).join('');

    // Districts
    const districtContainer = document.getElementById('district-filters');
    const districts = [...new Set(madridDistricts.features.map(f => f.properties.name))];
    districtContainer.innerHTML = districts.map(district => `
        <div class="filter-item">
            <label>
                <input type="checkbox" data-district="${district}" checked>
                ${district}
            </label>
        </div>
    `).join('');
}

function applyFilters() {
    const activeCategories = new Set(
        Array.from(document.querySelectorAll('[data-category]:checked'))
            .map(cb => cb.dataset.category)
    );
    
    const activeDistricts = new Set(
        Array.from(document.querySelectorAll('[data-district]:checked'))
            .map(cb => cb.dataset.district)
    );

    markersCache.forEach(marker => {
        const shouldShow = activeCategories.has(marker.options.properties.category) &&
                         activeDistricts.has(marker.options.properties.district);
        
        if (shouldShow && !markersCluster.hasLayer(marker)) {
            markersCluster.addLayer(marker);
        } else if (!shouldShow && markersCluster.hasLayer(marker)) {
            markersCluster.removeLayer(marker);
        }
    });

    updateStatistics();
}

// Statistics System
function updateStatistics() {
    const stats = {
        total: 0,
        categories: {},
        districts: {}
    };

    markersCache.forEach(marker => {
        if (!markersCluster.hasLayer(marker)) return;
        
        const props = marker.options.properties;
        stats.total++;
        stats.categories[props.category] = (stats.categories[props.category] || 0) + 1;
        stats.districts[props.district] = (stats.districts[props.district] || 0) + 1;
    });

    updateStatsDisplay(stats);
}

function updateStatsDisplay(stats) {
    let html = `<div class="stats-section">
        <h3>Total Elements: ${stats.total}</h3>
        <div class="stats-grid">`;

    // Categories
    Object.entries(stats.categories).forEach(([category, count]) => {
        html += `<div class="stat-item" style="border-color: ${CONFIG.COLORS[category]}">
            <span>${category}</span>
            <span>${count}</span>
        </div>`;
    });

    html += `</div><h3>Districts Distribution</h3><div class="stats-grid">`;

    // Districts
    Object.entries(stats.districts).forEach(([district, count]) => {
        html += `<div class="stat-item">
            <span>${district}</span>
            <span>${count}</span>
        </div>`;
    });

    document.getElementById('stats-breakdown').innerHTML = html + '</div>';
}

function validateCoordinates(lng, lat) {
    // Verificar que sean números válidos
    if (typeof lng !== 'number' || typeof lat !== 'number' || 
        isNaN(lng) || isNaN(lat)) {
        console.warn('Invalid coordinate values:', { lng, lat });
        return false;
    }

    // Verificar rango geográfico de Madrid
    const madridBounds = {
        minLng: -4.35,
        maxLng: -3.1,
        minLat: 40.15,
        maxLat: 40.65
    };

    const isValid = lng >= madridBounds.minLng && lng <= madridBounds.maxLng &&
                   lat >= madridBounds.minLat && lat <= madridBounds.maxLat;

    if (!isValid) {
        console.warn('Coordinates out of Madrid bounds:', { lng, lat });
        return false;
    }

    return true;
}

// Update the validateRow function in app.js
function validateRow(row, dataset) {
    // Check for empty required fields
    const requiredFields = [...dataset.coordFields, 'district'];
    for (const field of requiredFields) {
        const value = row[field];
        if (value === null || value === undefined || value === '') {
            console.warn(`Empty required field '${field}' in row:`, row);
            return false;
        }
    }

    // Validate coordinate values
    const lngStr = row[dataset.coordFields[0]];
    const latStr = row[dataset.coordFields[1]];
    const lng = parseFloat(lngStr);
    const lat = parseFloat(latStr);
    
    if (isNaN(lng) || isNaN(lat)) {
        console.warn('Invalid numeric coordinates in row:', row);
        return false;
    }

    return true;
}

function normalizeDistrict(name) {
    if (!name || typeof name !== 'string') {
        console.warn('Invalid district name:', name);
        return 'Unknown';
    }

    // Normalizar el nombre
    const cleanName = name
        .trim()
        .toLowerCase()
        .normalize('NFD') // Separar tildes
        .replace(/[\u0300-\u036f]/g, '') // Eliminar tildes
        .replace(/-/g, ' ') // Convertir guiones a espacios
        .replace(/\s+/g, ' ') // Eliminar espacios múltiples
        .replace(/aravaca/g, '') // Eliminar "aravaca" para Moncloa
        .trim();

    // Mapeo de variantes comunes
    const districtVariants = {
        'moncloa': 'Moncloa-Aravaca',
        'chamberi': 'Chamberí',
        'vicalvaro': 'Vicálvaro',
        'fuencarral el pardo': 'Fuencarral-El Pardo',
        'puente de vallekas': 'Puente de Vallecas',
        'ciudad lineal': 'Ciudad Lineal',
        'san blas': 'San Blas-Canillejas',
        'barajas': 'Barajas'
    };

    // Buscar en variantes primero
    if (districtVariants[cleanName]) {
        return districtVariants[cleanName];
    }

    // Buscar en el GeoJSON
    const district = madridDistricts.features.find(f => {
        const districtName = f.properties.name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        return districtName.includes(cleanName) || cleanName.includes(districtName);
    });

    if (!district) {
        console.warn('District not found:', name);
        return 'Unknown';
    }

    return district.properties.name;
}

function createPopupContent() {
    const props = this.options.properties;
    return `<div class="popup-content">
        <h4>${props.category}</h4>
        <p><strong>District:</strong> ${props.district}</p>
        <p><strong>Type:</strong> ${props.type}</p>
        ${props.address !== 'N/A' ? `<p><strong>Address:</strong> ${props.address}</p>` : ''}
        <p><strong>ID:</strong> ${props.id}</p>
    </div>`;
}

function toggleStreetLabels() {
    map.hasLayer(streetLabelsLayer) ? 
        map.removeLayer(streetLabelsLayer) : 
        streetLabelsLayer.addTo(map);
}

function toggleDistrictLabels() {
    map.hasLayer(districtsLayer) ?
        map.removeLayer(districtsLayer) :
        districtsLayer.addTo(map);
}

// Loading Functions
function updateLoadingScreen(message) {
    const loadingStatus = document.querySelector('.loading-status');
    if (loadingStatus) {
        loadingStatus.textContent = message;
    }
}

function showLoadingProgress(percentage) {
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
    }
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

// Actualizar el CSS para el loading overlay
const loadingStyles = `
.loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.95);
    z-index: 9999;
    display: flex;
    justify-content: center;
    align-items: center;
}

.loading-container {
    text-align: center;
    padding: 2rem;
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.1);
}

.loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #0984e3;
    border-radius: 50%;
    margin: 0 auto 1rem;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.loading-status {
    font-weight: 600;
    margin-bottom: 1rem;
}

.loading-progress {
    height: 8px;
    background: rgba(0,0,0,0.1);
    border-radius: 4px;
    overflow: hidden;
}

.progress-bar {
    width: 0%;
    height: 100%;
    background: #0984e3;
    transition: width 0.3s ease;
}
`;

// Inyectar los estilos dinámicamente
const styleSheet = document.createElement("style");
styleSheet.type = "text/css";
styleSheet.innerText = loadingStyles;
document.head.appendChild(styleSheet);

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    await initMap();
    document.querySelector('.loading-overlay').classList.add('hidden');
});