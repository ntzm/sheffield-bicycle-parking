import fs from "fs";

const mapcompleteLayerUri =
	"https://studio.mapcomplete.org/12363857/layers/sheffield_cycle_parking/sheffield_cycle_parking.json";

const overpassQuery = `
[out:json][timeout:25];
area(id:3600106956)->.searchArea;
nwr["amenity"="bicycle_parking"](area.searchArea);
out center;
`;

const parkingResponse = await fetch("https://overpass-api.de/api/interpreter", {
	method: "POST",
	body: "data=" + encodeURIComponent(overpassQuery),
});

const parking = await parkingResponse.json();

function booleanise(v) {
	if (v === "yes") {
		return "Yes";
	}
	if (v === "no") {
		return "No";
	}
	if (v === "partial") {
		return "Partially";
	}
	return v;
}

const accessMap = {
	customers: "Customers only",
	members: "Members only",
	private: "Private",
};

const privateMap = {
	students: "Students only",
	employees: "Employees only",
};

const hangarOperators = ["Falco", "Cyclehoop"];

const bicycleParkingImplicitCovered = ["shed", "building"];

fs.writeFileSync(
	"./out.geojson",
	JSON.stringify({
		type: "FeatureCollection",
		features: (
			await Promise.all(
				parking.elements.map(async (element) => {
					const type = element.type;
					const id = element.id;
					const tags = element.tags;

					const { lat, lon } = element.center ?? element;

					const lines = [];

					function addProp(name, value) {
						lines.push(`**${name}:** ${value}`);
					}

					const is_hub =
						tags.bicycle_parking === "building" && tags.access !== "private";
					const is_hangar = hangarOperators.includes(tags.operator);

					if (tags.name) {
						lines.push(`# ${tags.name}`);
					} else if (tags.bicycle_parking === "informal") {
						lines.push("# Informal bike parking");
					} else if (is_hangar) {
						lines.push("# Bike hangar");
					} else if (tags.location === "underground") {
						lines.push("# Underground bike parking");
					} else {
						lines.push("# Bike parking");
					}

					if (tags.bicycle_parking === "wall_loops") {
						lines.push("**Wheel benders - not recommended for use**\n");
					}

					if (tags.description) {
						lines.push(`${tags.description}`);
					}

					const access = accessMap[tags.access];

					if (access) {
						const privateValue = privateMap[tags.private];

						if (privateValue) {
							addProp("Access", privateValue);
						} else {
							addProp("Access", access);
						}
					}

					if (tags.fee === "yes") {
						addProp("Fee", booleanise(tags.fee));

						if (tags.charge) {
							addProp("Cost", tags.charge);
						}
					}

					if (
						tags.covered &&
						!bicycleParkingImplicitCovered.includes(tags.bicycle_parking)
					) {
						addProp("Covered", booleanise(tags.covered));
					}

					if (tags.capacity) {
						addProp("Capacity", tags.capacity);
					}

					if (tags.operator) {
						addProp("Operated by", tags.operator);
					}

					if (tags.website) {
						lines.push(`**[[${tags.website}|Website]]**`);
					}

					if (tags.panoramax) {
						const result = await getPanoramaxData(tags.panoramax);

						if (result) {
							lines.push(`{{${result.thumbnailHref}}}`);
							lines.push(
								`Image is licensed by ${result.producers.join(", ")} under ${result.license}`,
							);
						}
					}

					lines.push(
						`[[https://mapcomplete.org/theme.html?z=18&lat=${lat}&lon=${lon}&userlayout=${encodeURIComponent(mapcompleteLayerUri)}#${type}/${id}|Edit]]`,
					);

					const text = lines.join("\n");

					return {
						type: "Feature",
						geometry: {
							type: "Point",
							coordinates: [lon, lat],
						},
						properties: { access: tags.access, text, is_hub, is_hangar },
					};
				}),
			)
		).toSorted((a, b) => a.properties.is_hub - b.properties.is_hub), // make sure hubs stay on top
	}),
);

async function getPanoramaxData(id) {
	const r = await fetch(
		`https://api.panoramax.xyz/api/search?limit=1&ids=${id}`,
		{
			headers: {
				Accept: "application/geo+json",
			},
		},
	);

	if (r.status !== 200) {
		console.warn(`Response ${response.status} from panoramax ${id}`);
		return null;
	}

	const response = await r.json();

	const features = response.features;

	if (features.length < 1) {
		console.warn(`No features for panoramax ${id}`);
		return null;
	}

	const feature = features[0];

	const thumbnailHref = feature.assets.thumb.href;
	const license = feature.properties.license;
	const producers = feature.providers
		.map((provider) => provider.name)
		.toReversed();

	return { thumbnailHref, license, producers };
}
