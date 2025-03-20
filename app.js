// Configuration
const CONFIG = {
    BASE_URL: 'https://raw.githubusercontent.com/JSebastianIEU/madrid_traffic_map/main/',
    MAX_ZOOM: 20,
    INITIAL_ZOOM: 14,
    ICON_SIZE: [28, 28]
};

// State
let map;
let markersCluster;
let activeFilters = {
    categories: new Set(),
    districts: new Set(),
    neighborhoods: new Set()
};

// Map Initialization
function initMap() {
    map = L.map('map', {
        maxZoom: CONFIG.MAX_ZOOM,
        minZoom: 10
    }).setView([40.4168, -3.7038], CONFIG.INITIAL_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    markersCluster = L.markerClusterGroup({
        chunkedLoading: true,
        chunkInterval: 100
    });
    map.addLayer(markersCluster);
}

// Data Loading
async function loadData() {
    try {
        const datasets = {
            'Traffic Lights': 'trafic.csv',
            'Streetlights': 'lamps.csv',
            'Acoustic Signals': 'acustic.csv'
        };

        const allData = [];
        
        for (const [category, file] of Object.entries(datasets)) {
            const response = await fetch(`${CONFIG.BASE_URL}${file}`);
            if (!response.ok) throw new Error(`Failed to load ${file}`);
            const csvData = await response.text();
            
            const results = Papa.parse(csvData, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            });
            
            const features = results.data.map(row => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [row.Longitude, row.Latitude]
                },
                properties: {
                    category: category,
                    district: row.district || 'Unknown',
                    neighborhood: category === 'Streetlights' ? (row.neighborhood || 'Unknown') : 'N/A',
                    type: row.type || 'N/A',
                    id: row.id || 'N/A',
                    address: category === 'Streetlights' ? (row.address || 'N/A') : undefined
                }
            }));
            
            allData.push(...features);
        }

        loadMarkers(allData);
        initFilters(allData);
        updateStatistics();
    } catch (error) {
        showError('Error loading data. Please try again later.');
        console.error('Error:', error);
    }
}

// Markers Management
function loadMarkers(data) {
    L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
            const icon = L.icon({
                iconUrl: `${CONFIG.BASE_URL}icons/${feature.properties.category.toLowerCase().replace(' ', '-')}.png`,
                iconSize: CONFIG.ICON_SIZE,
                error: () => showError(`Icon missing for ${feature.properties.category}`)
            });

            const marker = L.marker(latlng, { icon });
            marker.bindPopup(createPopupContent(feature.properties));
            return marker;
        }
    }).addTo(markersCluster);
}

// Filter System
function initFilters(data) {
    const categories = new Set(['Traffic Lights', 'Streetlights', 'Acoustic Signals']);
    const districts = new Set(data.map(f => f.properties.district));
    const neighborhoods = new Set(data.map(f => f.properties.neighborhood));

    // Create filters
    const createFilters = (containerId, values, type) => {
        const container = document.getElementById(containerId);
        values.forEach(value => container.appendChild(createCheckbox(value, type)));
    };

    createFilters('category-filters', categories, 'category');
    createFilters('district-filters', districts, 'district');
    createFilters('neighborhood-filters', neighborhoods, 'neighborhood');

    // Set initial active filters
    activeFilters.categories = new Set(categories);
    activeFilters.districts = new Set(districts);
    activeFilters.neighborhoods = new Set(neighborhoods);

    // Add event listeners
    document.querySelectorAll('.filter-item input').forEach(checkbox => {
        checkbox.addEventListener('change', handleFilterChange);
    });
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

function updateVisibility() {
    markersCluster.eachLayer(marker => {
        const props = marker.feature.properties;
        const visible = activeFilters.categories.has(props.category) &&
                      activeFilters.districts.has(props.district) &&
                      activeFilters.neighborhoods.has(props.neighborhood);
        
        marker.setOpacity(visible ? 1 : 0);
        marker.setStyle({fillOpacity: visible ? 1 : 0});
    });
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
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
});