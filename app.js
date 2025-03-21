// Configuration
const CONFIG = {
    BASE_URL: 'https://raw.githubusercontent.com/JSebastianIEU/madrid_traffic_map/main/',
    MAX_ZOOM: 20,
    INITIAL_ZOOM: 14,
    BATCH_SIZE: 500,
    BATCH_DELAY: 50,
    COLORS: {
        'Traffic Lights': '#ff4757',
        'Streetlights': '#ffa502',
        'Acoustic Signals': '#6c5ce7'
    },
    DATASETS: [
        { 
            name: 'Traffic Lights',
            file: 'trafic.csv',
            color: '#ff4757',
            coordFields: ['Longitude', 'Latitude']
        },
        {
            name: 'Streetlights',
            file: 'lamps.csv',
            color: '#ffa502',
            coordFields: ['Longitude', 'Latitude']
        },
        {
            name: 'Acoustic Signals',
            file: 'acustic.csv',
            color: '#6c5ce7',
            coordFields: ['Longitude', 'Latitude']
        }
    ]
};

// State
let map;
let markersCluster;
let activeFilters = {
    categories: new Set(),
    districts: new Set()
};
let loadingState = {
    total: 0,
    loaded: 0,
    currentDataset: ''
};
let streetLabelsLayer;

// Madrid District Structure
const MADRID_STRUCTURE = {
    districts: {
        1: 'Centro', 2: 'Arganzuela', 3: 'Retiro', 4: 'Salamanca', 5: 'Chamartín',
        6: 'Tetuán', 7: 'Chamberí', 8: 'Fuencarral-El Pardo', 9: 'Moncloa',
        10: 'Latina', 11: 'Carabanchel', 12: 'Usera', 13: 'Puente de Vallecas',
        14: 'Moratalaz', 15: 'Ciudad Lineal', 16: 'Hortaleza', 17: 'Villaverde',
        18: 'Villa de Vallecas', 19: 'Vicálvaro', 20: 'San Blas', 21: 'Barajas'
    }
};

const DISTRICT_MAPPING = {
    'HORTALEZA': 'Hortaleza',
    'Moncloa': 'Moncloa-Aravaca',
    'CARABANCHEL': 'Carabanchel',
    'PUENTE VALLEKAS': 'Puente de Vallecas',
    'FUENCARRAL': 'Fuencarral-El Pardo'
};

// Normalize district names
function normalizeDistrict(name) {
    if (!name) return 'Desconocido';
    const officialName = Object.values(MADRID_STRUCTURE.districts)
        .find(d => d.toLowerCase() === name.trim().toLowerCase());
    return officialName || DISTRICT_MAPPING[name.trim().toUpperCase()] || 'Desconocido';
}

// Loading functions
function updateLoadingScreen(message) {
    const loadingStatus = document.querySelector('.loading-status');
    if (loadingStatus) loadingStatus.textContent = message;
}

function updateProgress() {
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        const progress = (loadingState.loaded / loadingState.total) * 100 || 0;
        progressBar.style.width = `${progress}%`;
    }
}

// Coordinate parsing
function parseCoordinates(row, dataset) {
    try {
        const lngField = dataset.coordFields[0];
        const latField = dataset.coordFields[1];
        const lng = parseFloat(row[lngField]);
        const lat = parseFloat(row[latField]);

        if (isNaN(lng) || isNaN(lat)) {
            console.warn('Coordenadas inválidas:', row);
            return null;
        }

        if (lng < -4.35 || lng > -3.1 || lat < 40.15 || lat > 40.65) {
            console.warn('Coordenadas fuera de rango:', lng, lat);
            return null;
        }

        return [lng, lat];
    } catch (error) {
        console.error('Error procesando coordenadas:', error);
        return null;
    }
}

// Map initialization
async function initMap() {
    try {
        updateLoadingScreen('Inicializando mapa...');
        
        map = L.map('map', {
            maxZoom: CONFIG.MAX_ZOOM,
            minZoom: 12
        }).setView([40.4168, -3.7038], CONFIG.INITIAL_ZOOM);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);

        streetLabelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png');
        
        markersCluster = L.markerClusterGroup({
            chunkedLoading: true,
            chunkInterval: 100
        });
        map.addLayer(markersCluster);

    } catch (error) {
        showError(`Error al inicializar el mapa: ${error.message}`);
        document.querySelector('.loading-overlay').classList.add('hidden');
    }
}

// Data loading
async function loadData() {
    try {
        loadingState.total = CONFIG.DATASETS.reduce((acc, dataset) => acc + 5000, 0);
        
        for (const dataset of CONFIG.DATASETS) {
            loadingState.currentDataset = dataset.name;
            updateLoadingScreen(`Cargando ${dataset.name}...`);
            
            const response = await fetch(`${CONFIG.BASE_URL}${dataset.file}`);
            const csvData = await response.text();
            
            const results = Papa.parse(csvData, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                worker: false,
                fastMode: false
            });

            loadingState.total = results.data.length;
            loadingState.loaded = 0;
            
            const validFeatures = [];
            for (const row of results.data) {
                try {
                    const coords = parseCoordinates(row, dataset);
                    if (!coords) continue;

                    validFeatures.push({
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: coords },
                        properties: {
                            category: dataset.name,
                            district: normalizeDistrict(row.district),
                            type: row.type || 'N/A',
                            id: row.id || 'N/A',
                            address: row.address || 'N/A'
                        }
                    });

                    loadingState.loaded++;
                    if (loadingState.loaded % 100 === 0) updateProgress();

                } catch (error) {
                    console.warn('Error procesando fila:', row, error);
                }
            }
            
            await addMarkersInBatches(validFeatures, dataset.color);
        }

        document.querySelector('.loading-overlay').classList.add('hidden');
        initFilters();
        updateStatistics();

    } catch (error) {
        showError(`Error cargando datos: ${error.message}`);
        document.querySelector('.loading-overlay').classList.add('hidden');
    }
}

// Batch processing
async function addMarkersInBatches(features, color) {
    const batchSize = CONFIG.BATCH_SIZE;
    
    for (let i = 0; i < features.length; i += batchSize) {
        const batch = features.slice(i, i + batchSize);
        const markers = batch.map(feature => createMarker(feature, color));
        markersCluster.addLayers(markers);
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
    }
}

// Marker creation
function createMarker(feature, color) {
    const marker = L.circleMarker(feature.geometry.coordinates, {
        radius: 6,
        color: color,
        fillColor: color,
        fillOpacity: 0.7,
        properties: feature.properties
    }).bindPopup(createPopupContent(feature.properties));
    
    marker.on('mouseover', function() { this.openPopup(); });
    marker.on('mouseout', function() { this.closePopup(); });
    
    return marker;
}

// Filter system
function initFilters() {
    // Category filters
    const categoryContainer = document.getElementById('category-filters');
    categoryContainer.innerHTML = Object.keys(CONFIG.COLORS).map(category => `
        <div class="filter-item">
            <label>
                <input type="checkbox" data-category="${category}" checked>
                ${category}
            </label>
        </div>
    `).join('');

    // District filters
    const districtContainer = document.getElementById('district-filters');
    districtContainer.innerHTML = Object.values(MADRID_STRUCTURE.districts).map(district => `
        <div class="filter-item">
            <label>
                <input type="checkbox" data-district="${district}" checked>
                ${district}
            </label>
        </div>
    `).join('');

    // Initialize filters
    activeFilters.categories = new Set(Object.keys(CONFIG.COLORS));
    activeFilters.districts = new Set(Object.values(MADRID_STRUCTURE.districts));

    // Panel toggle
    document.querySelector('.toggle-panel').addEventListener('click', () => {
        document.querySelector('.control-panel').classList.toggle('collapsed');
    });
}

// Apply filters
function applyFilters() {
    activeFilters.categories = new Set(
        Array.from(document.querySelectorAll('[data-category]:checked'))
            .map(cb => cb.dataset.category)
    );
    
    activeFilters.districts = new Set(
        Array.from(document.querySelectorAll('[data-district]:checked'))
            .map(cb => cb.dataset.district)
    );

    updateVisibility();
    updateStatistics();
}

// Update visibility
function updateVisibility() {
    markersCluster.eachLayer(marker => {
        const props = marker.options.properties;
        const visible = activeFilters.categories.has(props.category) &&
                      activeFilters.districts.has(props.district);
        
        marker.setStyle({
            opacity: visible ? 1 : 0,
            fillOpacity: visible ? 0.7 : 0
        });
    });
}

// Statistics
function updateStatistics() {
    const stats = {
        totals: { categories: {}, districts: {} },
        breakdown: {}
    };

    markersCluster.eachLayer(marker => {
        if (marker.options.opacity === 0) return;
        const { category, district } = marker.options.properties;
        
        // Totals
        stats.totals.categories[category] = (stats.totals.categories[category] || 0) + 1;
        stats.totals.districts[district] = (stats.totals.districts[district] || 0) + 1;
        
        // Breakdown
        if (!stats.breakdown[district]) {
            stats.breakdown[district] = {
                total: 0,
                categories: {}
            };
        }
        stats.breakdown[district].total++;
        stats.breakdown[district].categories[category] = 
            (stats.breakdown[district].categories[category] || 0) + 1;
    });

    updateStatsDisplay(stats);
}

function updateStatsDisplay(stats) {
    let html = `<div class="stats-section">
                    <h3>Resumen General</h3>
                    <div class="stats-grid">`;
    
    // Category totals
    Object.entries(stats.totals.categories).forEach(([category, count]) => {
        html += `<div class="stat-item" style="border-left: 4px solid ${CONFIG.COLORS[category]}">
                    <span>${category}</span>
                    <span>${count}</span>
                 </div>`;
    });
    
    html += `</div></div><div class="stats-section"><h3>Por Distrito</h3>`;
    
    // District breakdown
    Object.entries(stats.breakdown).forEach(([district, data]) => {
        html += `<div class="district-group">
                    <h4>${district} (${data.total})</h4>
                    <div class="stats-grid">`;
        
        Object.entries(data.categories).forEach(([category, count]) => {
            html += `<div class="stat-item">
                        <span>${category}</span>
                        <span>${count}</span>
                     </div>`;
        });
        
        html += `</div></div>`;
    });
    
    html += `</div>`;
    document.getElementById('stats-breakdown').innerHTML = html;
}

// Popup content
function createPopupContent(properties) {
    return `<div class="popup-header" style="border-left: 4px solid ${CONFIG.COLORS[properties.category]}">
                <h4>${properties.category}</h4>
                <p><strong>Distrito:</strong> ${properties.district}</p>
                <p><strong>Tipo:</strong> ${properties.type}</p>
                ${properties.address !== 'N/A' ? `<p><strong>Dirección:</strong> ${properties.address}</p>` : ''}
                <p><strong>ID:</strong> ${properties.id}</p>
            </div>`;
}

// Helpers
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

// Label toggles
function toggleStreetLabels() {
    if (map.hasLayer(streetLabelsLayer)) {
        map.removeLayer(streetLabelsLayer);
    } else {
        streetLabelsLayer.addTo(map);
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    await initMap();
    await loadData();
});