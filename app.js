// Configuration
const CONFIG = {
    BASE_URL: 'https://raw.githubusercontent.com/JSebastianIEU/madrid_traffic_map/main/',
    MAX_ZOOM: 20,
    INITIAL_ZOOM: 14,
    ICON_SIZE: [28, 28],
    BATCH_SIZE: 500,
    BATCH_DELAY: 50
};

// State
let map;
let markersCluster;
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

// Loading Screen Control
function updateLoadingState() {
    const progress = (loadingState.loaded / loadingState.total) * 100;
    document.querySelector('.progress-bar').style.width = `${progress}%`;
    document.querySelector('.dataset-status').textContent = 
        `Loading ${loadingState.currentDataset}: ${loadingState.loaded}/${loadingState.total}`;
}

// Map Initialization
async function initMap() {
    updateLoadingScreen('Initializing map...');
    map = L.map('map', {
        maxZoom: CONFIG.MAX_ZOOM,
        minZoom: 10
    }).setView([40.4168, -3.7038], CONFIG.INITIAL_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

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
                fields: ['type', 'district', 'id', 'id_cruce', 'Longitude', 'Latitude']
            },
            {
                name: 'Streetlights',
                file: 'lamps.csv',
                fields: ['type', 'district', 'neighborhood', 'Latitude', 'Longitude', 'address']
            },
            {
                name: 'Acoustic Signals',
                file: 'acustic.csv',
                fields: ['type', 'district', 'id', 'id_cruce', 'Longitude', 'Latitude']
            }
        ];

        let allData = [];
        
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

                features.push(createFeature(row, dataset, coords));
                loadingState.loaded++;
                if (features.length % 100 === 0) updateLoadingState();
            }

            // Add features in optimized batches
            await addFeaturesInBatches(features);
            allData = allData.concat(features);
        }

        initFilters(allData);
        updateStatistics();
        document.querySelector('.loading-overlay').classList.add('hidden');
    } catch (error) {
        showError(error.message);
        console.error('Error:', error);
    }
}

function parseCoordinates(row, dataset) {
    try {
        let lng, lat;
        const coordKeys = {
            'Streetlights': ['Longitude', 'Latitude'],
            'Traffic Lights': ['Longitude', 'Latitude'],
            'Acoustic Signals': ['Longitude', 'Latitude']
        };

        const [lngKey, latKey] = coordKeys[dataset.name];
        lng = parseCoordinateValue(row[lngKey]);
        lat = parseCoordinateValue(row[latKey]);

        if (!lng || !lat || isNaN(lng) || isNaN(lat)) {
            console.warn('Invalid coordinates:', row);
            return null;
        }

        return [lng, lat];
    } catch (error) {
        console.warn('Coordinate parsing error:', error);
        return null;
    }
}

function parseCoordinateValue(value) {
    if (typeof value === 'string') {
        // Handle comma decimal separators
        return parseFloat(value.replace(',', '.').trim());
    }
    return parseFloat(value);
}

function createFeature(row, dataset, coords) {
    return {
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
    };
}

async function addFeaturesInBatches(features) {
    const iconCache = {};
    let processed = 0;
    
    while (processed < features.length) {
        const batch = features.slice(processed, processed + CONFIG.BATCH_SIZE);
        const markers = batch.map(feature => {
            const category = feature.properties.category;
            if (!iconCache[category]) {
                iconCache[category] = L.icon({
                    iconUrl: `${CONFIG.BASE_URL}icons/${category.toLowerCase().replace(' ', '-')}.png`,
                    iconSize: CONFIG.ICON_SIZE,
                    error: () => L.divIcon({
                        className: 'custom-marker',
                        html: '📍',
                        iconSize: [30, 30]
                    })
                });
            }
            const marker = L.marker(feature.geometry.coordinates, { 
                icon: iconCache[category] 
            });
            marker.bindPopup(createPopupContent(feature.properties));
            return marker;
        });
        
        markersCluster.addLayers(markers);
        processed += batch.length;
        loadingState.loaded += batch.length;
        updateLoadingState();
        
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
    }
}

// Add debounce to filter handling
let filterTimeout;
function handleFilterChange() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        activeFilters.categories = new Set(
            Array.from(document.querySelectorAll('[data-category]:checked'))
                .map(cb => cb.dataset.category)
        );
        
        activeFilters.districts = new Set(
            Array.from(document.querySelectorAll('[data-district]:checked'))
                .map(cb => cb.dataset.district)
        );

        activeFilters.neighborhoods = new Set(
            Array.from(document.querySelectorAll('[data-neighborhood]:checked'))
                .map(cb => cb.dataset.neighborhood)
        );

        requestAnimationFrame(() => {
            updateVisibility();
            updateStatistics();
        });
    }, 200); // Increased debounce time
}

// Filter System
function initFilters(data) {
    console.log('Initializing filters with data:', data);
    
    // Collect unique values
    const categories = [...new Set(data.map(f => f.properties.category))];
    const districts = [...new Set(data.map(f => f.properties.district))];
    const neighborhoods = [...new Set(data.map(f => f.properties.neighborhood))];

    console.log('Filter options:', { categories, districts, neighborhoods });

    populateFilters('category-filters', categories, 'category');
    populateFilters('district-filters', districts, 'district');
    populateFilters('neighborhood-filters', neighborhoods, 'neighborhood');

    // Set initial active filters
    activeFilters.categories = new Set(categories);
    activeFilters.districts = new Set(districts);
    activeFilters.neighborhoods = new Set(neighborhoods);

    console.log('Active filters initialized:', activeFilters);
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
function createCheckbox(value, type) {
    const container = document.createElement('div');
    container.className = 'filter-item';
    
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset[type] = value;
    
    label.appendChild(input);
    label.appendChild(document.createTextNode(value));
    container.appendChild(label);
    
    return container;
}

// Filter Handlers
function handleFilterChange() {
    activeFilters.categories = new Set(
        Array.from(document.querySelectorAll('[data-category]:checked'))
            .map(cb => cb.dataset.category)
    );
    
    activeFilters.districts = new Set(
        Array.from(document.querySelectorAll('[data-district]:checked'))
            .map(cb => cb.dataset.district)
    );

    activeFilters.neighborhoods = new Set(
        Array.from(document.querySelectorAll('[data-neighborhood]:checked'))
            .map(cb => cb.dataset.neighborhood)
    );

    updateVisibility();
    updateStatistics();
}

// Modify updateVisibility to use requestAnimationFrame
function updateVisibility() {
    let layers = [];
    markersCluster.eachLayer(layer => layers.push(layer));
    
    let index = 0;
    
    function processLayer() {
        for(let i = 0; i < 100; i++) {
            if(index >= layers.length) return;
            
            const layer = layers[index];
            const props = layer.feature.properties;
            const visible = activeFilters.categories.has(props.category) &&
                          activeFilters.districts.has(props.district) &&
                          activeFilters.neighborhoods.has(props.neighborhood);
            
            layer.setOpacity(visible ? 1 : 0);
            layer.setStyle({ fillOpacity: visible ? 1 : 0 });
            
            index++;
        }
        
        requestAnimationFrame(processLayer);
    }
    
    processLayer();
}

// Statistics System
function updateStatistics() {
    const counts = {
        total: 0,
        categories: new Map(),
        districts: new Map()
    };

    markersCluster.eachLayer(marker => {
        if (marker.options.opacity === 1) {
            const props = marker.feature.properties;
            counts.total++;
            counts.categories.set(props.category, (counts.categories.get(props.category) || 0) + 1);
            counts.districts.set(props.district, (counts.districts.get(props.district) || 0) + 1);
        }
    });

    updateStatsDisplay(counts);
}

function updateStatsDisplay(counts) {
    document.getElementById('total-count').textContent = `Total Items: ${counts.total}`;
    
    document.getElementById('category-counts').innerHTML = Array.from(counts.categories.entries())
        .map(([name, count]) => `
            <div class="stat-item">
                <span>${name}</span>
                <span>${count}</span>
            </div>
        `).join('');
    
    document.getElementById('district-counts').innerHTML = Array.from(counts.districts.entries())
        .map(([name, count]) => `
            <div class="stat-item">
                <span>${name}</span>
                <span>${count}</span>
            </div>
        `).join('');
}

// Helper Functions
function toggleControlPanel() {
    document.querySelector('.control-panel').classList.toggle('collapsed');
}

function createPopupContent(properties) {
    let content = `<h4>${properties.category}</h4>`;
    content += `<p><strong>District:</strong> ${properties.district}</p>`;
    
    switch(properties.category) {
        case 'Acoustic Signals':
            content += `<p><strong>Type:</strong> ${properties.type}</p>`;
            content += `<p><strong>ID:</strong> ${properties.id}</p>`;
            break;
        case 'Streetlights':
            content += `<p><strong>Type:</strong> ${properties.type}</p>`;
            content += `<p><strong>Neighborhood:</strong> ${properties.neighborhood}</p>`;
            content += `<p><strong>Address:</strong> ${properties.address}</p>`;
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

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    await initMap();
    await loadData();
});