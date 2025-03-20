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
    }
};

// State
let map;
let markersCluster;
let baseLayer, poiLayer;
let activeFilters = {
    categories: new Set(),
    districts: new Set(),
    neighborhoods: new Set()
};
let loadingState = {
    total: 0,
    loaded: 0,
    currentDataset: ''
};

// Map Initialization
async function initMap() {
    updateLoadingScreen('Initializing map...');
    map = L.map('map', {
        maxZoom: CONFIG.MAX_ZOOM,
        minZoom: 12
    }).setView([40.4168, -3.7038], CONFIG.INITIAL_ZOOM);

    // Base map layer without labels
    baseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // POI Layer with labels
    poiLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    });

    markersCluster = L.markerClusterGroup({
        chunkedLoading: true,
        chunkInterval: 100,
        disableClusteringAtZoom: 16
    });
    map.addLayer(markersCluster);
}

// Data Loading
async function loadData() {
    try {
        const datasets = [
            { 
                name: 'Traffic Lights',
                file: 'trafic.csv',
                color: CONFIG.COLORS['Traffic Lights']
            },
            {
                name: 'Streetlights',
                file: 'lamps.csv',
                color: CONFIG.COLORS['Streetlights']
            },
            {
                name: 'Acoustic Signals',
                file: 'acustic.csv',
                color: CONFIG.COLORS['Acoustic Signals']
            }
        ];

        for (const dataset of datasets) {
            loadingState.currentDataset = dataset.name;
            updateLoadingScreen(`Loading ${dataset.name} data...`);
            
            const url = `${CONFIG.BASE_URL}${dataset.file}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to load ${dataset.file}`);
            
            const csvData = await response.text();
            const results = Papa.parse(csvData, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            });

            loadingState.total = results.data.length;
            loadingState.loaded = 0;
            updateLoadingState();

            const features = [];
            for (const row of results.data) {
                const coords = parseCoordinates(row, dataset);
                if (!coords) continue;

                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: coords
                    },
                    properties: {
                        category: dataset.name,
                        district: row.district || 'Unknown',
                        neighborhood: dataset.name === 'Streetlights' ? row.neighborhood : 'N/A',
                        type: row.type || 'N/A',
                        id: row.id || 'N/A',
                        address: dataset.name === 'Streetlights' ? row.address : 'N/A'
                    }
                });
                loadingState.loaded++;
                if (features.length % 100 === 0) updateLoadingState();
            }

            await addMarkersInBatches(features, dataset.color);
        }

        initFilters();
        updateStatistics();
        document.querySelector('.loading-overlay').classList.add('hidden');
    } catch (error) {
        showError(error.message);
        console.error('Error:', error);
    }
}

// Coordinate Parsing
function parseCoordinates(row, dataset) {
    try {
        let lng, lat;
        if (dataset.name === 'Streetlights') {
            lat = parseFloat(row.Latitude);
            lng = parseFloat(row.Longitude);
        } else {
            lng = parseFloat(row.Longitude);
            lat = parseFloat(row.Latitude);
        }

        if (isNaN(lng)) lng = parseFloat(String(row.Longitude).replace(',', '.'));
        if (isNaN(lat)) lat = parseFloat(String(row.Latitude).replace(',', '.'));

        if (isNaN(lng) || isNaN(lat)) return null;
        return [lng, lat];
    } catch (error) {
        console.warn('Coordinate error:', error);
        return null;
    }
}

// Marker Creation
async function addMarkersInBatches(features, color) {
    const batchSize = CONFIG.BATCH_SIZE;
    for (let i = 0; i < features.length; i += batchSize) {
        const batch = features.slice(i, i + batchSize);
        const markers = batch.map(feature => 
            L.circleMarker(feature.geometry.coordinates, {
                radius: 5,
                color: color,
                fillColor: color,
                fillOpacity: 0.7
            }).bindPopup(createPopupContent(feature.properties))
        );
        
        markersCluster.addLayers(markers);
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
    }
}

// Filter System
function initFilters() {
    const districtNeighborhoods = {};
    markersCluster.eachLayer(marker => {
        const { district, neighborhood } = marker.feature.properties;
        if (!districtNeighborhoods[district]) districtNeighborhoods[district] = new Set();
        districtNeighborhoods[district].add(neighborhood);
    });

    populateFilters('district-filters', Object.keys(districtNeighborhoods), 'district', updateNeighborhoodFilters);
    updateNeighborhoodFilters();
    populateFilters('category-filters', ['Traffic Lights', 'Streetlights', 'Acoustic Signals'], 'category');
}

function updateNeighborhoodFilters() {
    const selectedDistricts = Array.from(document.querySelectorAll('[data-district]:checked'))
        .map(cb => cb.dataset.district);
    
    const availableNeighborhoods = new Set();
    selectedDistricts.forEach(district => {
        markersCluster.eachLayer(marker => {
            if (marker.feature.properties.district === district) {
                availableNeighborhoods.add(marker.feature.properties.neighborhood);
            }
        });
    });

    populateFilters('neighborhood-filters', Array.from(availableNeighborhoods), 'neighborhood');
}

function populateFilters(containerId, values, type) {
    const container = document.getElementById(containerId);
    container.innerHTML = values
        .filter(v => v && v !== 'Unknown')
        .map(value => `
            <div class="filter-item">
                <label>
                    <input type="checkbox" data-${type}="${value}" checked>
                    ${value}
                </label>
            </div>
        `).join('');
}

// Filter Application
function applyFilters() {
    activeFilters = {
        categories: new Set(Array.from(document.querySelectorAll('[data-category]:checked'))
            .map(cb => cb.dataset.category)),
        districts: new Set(Array.from(document.querySelectorAll('[data-district]:checked'))
            .map(cb => cb.dataset.district)),
        neighborhoods: new Set(Array.from(document.querySelectorAll('[data-neighborhood]:checked'))
            .map(cb => cb.dataset.neighborhood))
    };

    updateVisibility();
    updateStatistics();
}

// Visibility Update
function updateVisibility() {
    markersCluster.eachLayer(marker => {
        const { category, district, neighborhood } = marker.feature.properties;
        const visible = activeFilters.categories.has(category) &&
                      activeFilters.districts.has(district) &&
                      activeFilters.neighborhoods.has(neighborhood);
        
        marker.setStyle({
            opacity: visible ? 1 : 0,
            fillOpacity: visible ? 0.7 : 0
        });
    });
}

// Statistics System
function updateStatistics() {
    const stats = {
        totals: { 'Traffic Lights': 0, 'Streetlights': 0, 'Acoustic Signals': 0 },
        districts: {},
        neighborhoods: {}
    };

    markersCluster.eachLayer(marker => {
        if (marker.options.opacity !== 1) return;
        const { category, district, neighborhood } = marker.feature.properties;
        
        // Update totals
        stats.totals[category]++;
        
        // District stats
        if (!stats.districts[district]) {
            stats.districts[district] = { total: 0, ...stats.totals };
        }
        stats.districts[district].total++;
        stats.districts[district][category]++;
        
        // Neighborhood stats
        if (!stats.neighborhoods[neighborhood]) {
            stats.neighborhoods[neighborhood] = { total: 0, ...stats.totals };
        }
        stats.neighborhoods[neighborhood].total++;
        stats.neighborhoods[neighborhood][category]++;
    });

    updateStatsDisplay(stats);
}

function updateStatsDisplay(stats) {
    const total = Object.values(stats.totals).reduce((a, b) => a + b, 0);
    let html = `
        <div class="stats-summary">
            <h4>Total Selected: ${total}</h4>
            <div class="stats-grid">
                ${Object.entries(stats.totals).map(([cat, count]) => `
                    <div class="stat-item" style="border-left: 4px solid ${CONFIG.COLORS[cat]}">
                        <span>${cat}</span>
                        <span>${count}</span>
                    </div>
                `).join('')}
            </div>
        </div>`;

    html += `<div class="district-breakdown">`;
    for (const [district, data] of Object.entries(stats.districts)) {
        html += `
            <div class="district-group">
                <h4>${district}</h4>
                <div class="stats-grid">
                    ${Object.entries(CONFIG.COLORS).map(([cat]) => `
                        <div class="stat-item">
                            <span>${cat}</span>
                            <span>${data[cat] || 0}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="total">Total: ${data.total}</div>
            </div>`;
    }
    html += `</div>`;

    document.getElementById('stats-breakdown').innerHTML = html;
}

// Helper Functions
function togglePOI() {
    map.hasLayer(poiLayer) ? map.removeLayer(poiLayer) : map.addLayer(poiLayer);
    map.hasLayer(baseLayer) ? map.removeLayer(baseLayer) : map.addLayer(baseLayer);
}

function createPopupContent(properties) {
    let content = `<h4>${properties.category}</h4>
                  <p><strong>District:</strong> ${properties.district}</p>`;
    
    switch(properties.category) {
        case 'Acoustic Signals':
            content += `<p><strong>Type:</strong> ${properties.type}</p>
                       <p><strong>ID:</strong> ${properties.id}</p>`;
            break;
        case 'Streetlights':
            content += `<p><strong>Type:</strong> ${properties.type}</p>
                       <p><strong>Neighborhood:</strong> ${properties.neighborhood}</p>
                       <p><strong>Address:</strong> ${properties.address}</p>`;
            break;
        case 'Traffic Lights':
            content += `<p><strong>ID:</strong> ${properties.id}</p>`;
            break;
    }
    return content;
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

function updateLoadingScreen(message) {
    document.querySelector('.loading-status').textContent = message;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    await initMap();
    await loadData();
});