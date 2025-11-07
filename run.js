import fs from "fs";

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

const hangarOperators = ["Falco", "Cyclehoop"];

const bicycleParkingImplicitCovered = ["shed", "building"];

fs.writeFileSync(
	"./out.geojson",
	JSON.stringify({
		type: "FeatureCollection",
		features: (
			await Promise.all(
				parking.elements.map(async (f) => {
					const p = f.tags;
					const lines = [];

					function addProp(name, value) {
						lines.push(`**${name}:** ${value}`);
					}

					const is_hub =
						p.bicycle_parking === "building" && p.access !== "private";
					const is_hangar = hangarOperators.includes(p.operator);

					if (p.name) {
						lines.push(`# ${p.name}`);
					} else if (p.bicycle_parking === "informal") {
						lines.push("# Informal bike parking");
					} else if (is_hangar) {
						lines.push("# Bike hangar");
					} else {
						lines.push("# Bike parking");
					}

					if (p.bicycle_parking === "wall_loops") {
						lines.push("**Wheel benders - not recommended for use**\n");
					}

					if (p.description) {
						lines.push(`${p.description}`);
					}

					const access = accessMap[p.access];

					if (access) {
						if (p.private === "students") {
							addProp("Access", "Students only");
						} else {
							addProp("Access", access);
						}
					}

					if (p.fee === "yes") {
						addProp("Fee", booleanise(p.fee));

						if (p.charge) {
							addProp("Cost", p.charge);
						}
					}

					if (
						p.covered &&
						!bicycleParkingImplicitCovered.includes(p.bicycle_parking)
					) {
						addProp("Covered", booleanise(p.covered));
					}

					if (p.capacity) {
						addProp("Capacity", p.capacity);
					}

					if (p.operator) {
						addProp("Operated by", p.operator);
					}

					if (p.website) {
						lines.push(`**[[${p.website}|Website]]**`);
					}

					if (p.panoramax) {
						const result = await getPanoramaxData(p.panoramax);

						if (result) {
							lines.push(`{{${result.thumbnailHref}}}`);
							lines.push(
								`Image is licensed by ${result.producers.join(", ")} under ${result.license}`,
							);
						}
					}

					const text = lines.join("\n");

					return {
						type: "Feature",
						geometry: {
							type: "Point",
							coordinates: f.center
								? [f.center.lon, f.center.lat]
								: [f.lon, f.lat],
						},
						properties: { access: p.access, text, is_hub, is_hangar },
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
