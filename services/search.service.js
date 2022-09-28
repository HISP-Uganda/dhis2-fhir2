"use strict";

const { capitalize } = require("lodash");
const { isArray } = require("lodash");
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

let bfs = function (tree, key, collection) {
	if (!tree[key] || tree[key].length === 0) return;
	for (let i = 0; i < tree[key].length; i++) {
		let child = tree[key][i];
		collection[`${child.url}`] = child;
		bfs(child, key, collection);
	}
	return;
};

module.exports = {
	name: "search",
	/**
	 * Settings
	 */
	settings: {},
	/**
	 * Dependencies
	 */
	dependencies: ["es"],

	/**
	 * Actions
	 */
	actions: {
		entity: {
			async handler(ctx) {
				const entities = await ctx.call("es.search", {
					index: "entities",
					body: { query: { match: { "type.keyword": "Person" } }, size: 1000 },
				});
				if (entities.length > 0) {
					const [entity] = entities;
					return this.getDHIS2Code(entity.mappings);
				}
				return null;
			},
		},
		facility: {
			async handler(ctx) {
				if (ctx.params.ref && ctx.identifier && ctx.params.identifier.value) {
					const organisationSearch = await ctx.call("es.searchById", {
						id: ctx.identifier.value,
						index: "organisations",
					});
					return this.getDHIS2Code(organisationSearch.mappings);
				} else if (ctx.params.reference) {
					const id = String(ctx.params.reference).replace("Organization/", "");
					const organisationSearch = await ctx.call("es.searchById", {
						id,
						index: "organisations",
					});
					return this.getDHIS2Code(organisationSearch.mappings);
				}
			},
		},
		patient: {
			async handler(ctx) {
				const attributes = await ctx.call("es.search", {
					index: "attributes",
					body: { query: { match_all: {} }, size: 1000 },
				});
				const identifiers = this.getIdentifiers(ctx.params, attributes);

				let maritalStatus = "";
				if (ctx.params.maritalStatus && ctx.params.maritalStatus.coding) {
					const [{ system, code }] = ctx.params.maritalStatus.coding;
					const conceptSearch = await ctx.call("es.searchBySystemAndCode", {
						system,
						value: code,
						index: "concepts",
					});
					if (conceptSearch) {
						maritalStatus = this.getDHIS2Option(conceptSearch);
					}
				} else if (ctx.params.maritalStatus) {
					maritalStatus = ctx.params.maritalStatus.text;
				}
				const obj = {
					birthDate: ctx.params.birthDate,
					given:
						ctx.params.name.length > 0
							? [ctx.params.name[0].family, ...ctx.params.name[0].given].join(
									" "
							  )
							: "",
					gender: capitalize(ctx.params.gender),
					telecom:
						ctx.params.telecom.length > 0 ? ctx.params.telecom[0].value : "",
					address:
						ctx.params.address.length > 0 ? ctx.params.address[0].text : "",
					maritalStatus,
				};
				const biodata = [
					"birthDate",
					"maritalStatus",
					"given",
					"gender",
					"telecom",
					"address",
				].flatMap((a) => {
					const attribute = this.searchAttribute(attributes, "type", a);
					const value = obj[a];
					if (attribute && value) {
						return [{ attribute, value }];
					}
					return [];
				});
				const extensions = this.getExtensions(ctx.params, attributes);
				return {
					identifiers,
					biodata: [...biodata, ...extensions],
				};
			},
		},
		previousPatient: {
			async handler(ctx) {
				let should = [];

				if (ctx.params.patientId) {
					should = [
						...should,
						{ term: { "patientId.keyword": ctx.params.patientId } },
					];
				}

				if (ctx.params.identifiers && ctx.params.identifiers.length > 0) {
					should = [
						...should,
						{ terms: { "identifiers.keyword": ctx.params.identifiers } },
					];
				}
				if (should.length > 0) {
					const search = await ctx.call("es.search", {
						index: "patients",
						body: {
							query: {
								bool: {
									should,
								},
							},
						},
					});
					if (search.length > 0) {
						return search[0];
					}
				}
			},
		},
		previousEOC: {
			async handler(ctx) {
				const { trackedEntityInstance, enrollmentDate, program, orgUnit, id } =
					ctx.params;

				let must = [];

				if (trackedEntityInstance) {
					must = [
						...must,
						{
							term: { "trackedEntityInstance.keyword": trackedEntityInstance },
						},
					];
				}

				if (orgUnit) {
					must = [...must, { term: { "orgUnit.keyword": orgUnit } }];
				}
				if (program) {
					must = [...must, { term: { "program.keyword": program } }];
				}
				if (enrollmentDate) {
					must = [...must, { term: { enrollmentDate: enrollmentDate } }];
				}
				if (id) {
					must = [...must, { term: { "eocId.keyword": id } }];
				}
				const search = await ctx.call("es.search", {
					index: "enrollments",
					body: {
						query: {
							bool: {
								must,
							},
						},
					},
				});
				if (search.length > 0) {
					return search[0];
				}
			},
		},
		findEOC: {
			async handler(ctx) {
				const { id, trackedEntityInstance, orgUnit } = ctx.params;
				const search = await ctx.call("es.search", {
					index: "enrollments",
					body: {
						query: {
							bool: {
								must: [
									{
										term: {
											"trackedEntityInstance.keyword": trackedEntityInstance,
										},
									},
									{ term: { "orgUnit.keyword": orgUnit } },
									{ term: { "eocId.keyword": id } },
								],
							},
						},
					},
				});
				if (search.length > 0) {
					return search[0];
				}
			},
		},

		previousEncounter: {
			async handler(ctx) {
				const {
					id,
					trackedEntityInstance,
					eventDate,
					orgUnit,
					programStage,
					enrollment,
					program,
				} = ctx.params;

				let must = [];

				if (trackedEntityInstance) {
					must = [
						...must,
						{
							term: { "trackedEntityInstance.keyword": trackedEntityInstance },
						},
					];
				}

				if (orgUnit) {
					must = [...must, { term: { "orgUnit.keyword": orgUnit } }];
				}
				if (program) {
					must = [...must, { term: { "program.keyword": program } }];
				}
				if (eventDate) {
					must = [...must, { term: { eventDate } }];
				}
				if (id) {
					must = [...must, { term: { "encounterId.keyword": id } }];
				}
				if (enrollment) {
					must = [...must, { term: { "enrollment.keyword": enrollment } }];
				}
				if (programStage) {
					must = [...must, { term: { "programStage.keyword": programStage } }];
				}
				const search = await ctx.call("es.search", {
					index: "encounters",
					body: {
						query: {
							bool: {
								must,
							},
						},
					},
				});
				if (search.length > 0) {
					return search[0];
				}
			},
		},

		findEncounter: {
			async handler(ctx) {
				const { id, trackedEntityInstance, orgUnit } = ctx.params;

				let must = [];

				if (trackedEntityInstance) {
					must = [
						...must,
						{
							term: { "trackedEntityInstance.keyword": trackedEntityInstance },
						},
					];
				}

				if (orgUnit) {
					must = [...must, { term: { "orgUnit.keyword": orgUnit } }];
				}

				if (id) {
					must = [...must, { term: { "encounterId.keyword": id } }];
				}
				const search = await ctx.call("es.search", {
					index: "encounters",
					body: {
						query: {
							bool: {
								must,
							},
						},
					},
				});
				if (search.length > 0) {
					return search[0];
				}
			},
		},

		program: {
			async handler(ctx) {
				const programSearch = await ctx.call("es.searchBySystemAndCode", {
					system: ctx.params.system,
					value: ctx.params.code,
					index: "programs",
				});
				if (programSearch) {
					return this.getDHIS2Code(programSearch);
				}
				return null;
			},
		},
		stage: {
			async handler(ctx) {
				let encounterSearch = await ctx.call("es.searchBySystemAndCode", {
					system: ctx.params.system,
					value: ctx.params.code,
					index: "stages",
				});

				if (encounterSearch) {
					return this.getDHIS2Code(encounterSearch);
				}
				return null;
			},
		},
		concept: {
			async handler(ctx) {
				const conceptSearch = await ctx.call("es.searchBySystemAndCode", {
					system: ctx.params.system,
					value: ctx.params.code,
					index: "concepts",
				});

				if (conceptSearch) {
					return this.getDHIS2Code(conceptSearch);
				}
				return null;
			},
		},
		option: {
			async handler(ctx) {
				const conceptSearch = await ctx.call("es.searchBySystemAndCode", {
					system: ctx.params.system,
					value: ctx.params.code,
					index: "concepts",
				});

				if (conceptSearch) {
					return this.getDHIS2Option(conceptSearch);
				}
				return null;
			},
		},
	},

	/**
	 * Events
	 */
	events: {},

	/**
	 * Methods
	 */
	methods: {
		getDHIS2Code(mappings) {
			if (mappings !== undefined && isArray(mappings)) {
				const search = mappings.find((mapping) => mapping.system === "DHIS2");
				if (search) {
					return search.code;
				}
			}
		},
		getDHIS2Option(mappings) {
			if (mappings !== undefined && isArray(mappings)) {
				const search = mappings.find(
					(mapping) => mapping.system === "http://tbl-ecbss.go.ug/options"
				);
				if (search) {
					return search.code;
				}
			}
		},
		getReference(ref) {
			if (ref && ref.identifier && ref.identifier.value) {
				return ref.identifier.value;
			} else if (ref.reference) {
				return String(ref.reference).replace("Organization/", "");
			}
		},
		searchOne(identifies, field, attribute1, attribute2, value1, value2) {
			const response = identifies.find((identifier) => {
				return (
					identifier[field].find(
						(mapping) =>
							mapping[attribute1] === value1 && mapping[attribute2] === value2
					) !== undefined
				);
			});
			if (response) {
				const { mappings } = response;
				return this.getDHIS2Code(mappings);
			}
			return undefined;
		},
		searchSystem(identifies, value) {
			const response = identifies.find((identifier) => {
				return (
					identifier["mappings"].find((mapping) => mapping.system === value) !==
					undefined
				);
			});
			if (response) {
				const { mappings } = response;
				return this.getDHIS2Code(mappings);
			}
			return undefined;
		},
		getExtensions(patient, attributes) {
			let allKeys = {};
			bfs(patient, "extension", allKeys);
			patient.address.forEach((a) => {
				let current = {};
				bfs(a, "extension", current);
				allKeys = { ...allKeys, ...current };
			});

			const extensions = attributes.filter((a) => a.type === "extension");
			return Object.values(allKeys).flatMap(
				({
					valueQuantity,
					valueCodeableConcept,
					valueString,
					valueBoolean,
					valueInteger,
					valueTime,
					valueDateTime,
					url,
				}) => {
					let realValue =
						valueString ||
						valueBoolean ||
						valueInteger ||
						valueTime ||
						valueDateTime;
					if (valueQuantity) {
						realValue = valueQuantity.value;
					}
					if (valueCodeableConcept) {
						const valueCode = valueCodeableConcept.coding.find(
							(code) => !!code.system
						);
						if (valueCode) {
							realValue = valueCode.code;
						}
					}
					if (realValue) {
						const attribute = this.searchSystem(extensions, url);
						if (attribute) {
							return [{ attribute, value: realValue }];
						}
						return [];
					}
					return [];
				}
			);
		},
		getIdentifiers(patient, attributes) {
			const identifiers = attributes.filter((a) => a.identifier);
			return patient.identifier.flatMap((currentIdentifier) => {
				if (currentIdentifier.type.coding) {
					const [{ code, system }] = currentIdentifier.type.coding;
					const attribute = this.searchOne(
						identifiers,
						"mappings",
						"code",
						"system",
						code,
						system
					);
					if (attribute) {
						return [{ attribute, value: currentIdentifier.value }];
					}
				} else if (currentIdentifier.type.text && currentIdentifier.id) {
					const system = currentIdentifier.type.text;
					const code = currentIdentifier.id;
					const attribute = this.searchOne(
						identifiers,
						"mappings",
						"code",
						"system",
						code,
						system
					);
					if (attribute) {
						return [{ attribute, value: currentIdentifier.value }];
					}
				}
				return [];
			});
		},
		searchAttribute(attributes, type, value) {
			const attribute = attributes.find((a) => {
				return a[type] === value;
			});
			if (attribute) {
				return this.getDHIS2Code(attribute.mappings);
			}
			return null;
		},

		getBio(patient, attributes) {
			let maritalStatus = "";
			if (patient.maritalStatus && patient.maritalStatus.coding) {
				const [{ system, code }] = patient.maritalStatus.coding;
			}
			const obj = {
				birthDate: patient.birthDate,
				given:
					patient.name.length > 0
						? [patient.name[0].family, ...patient.name[0].given].join(" ")
						: "",
				gender: capitalize(patient.gender),
				telecom: patient.address.length > 0 ? patient.address[0].text : "",
				address: patient.address.length > 0 ? patient.address[0].text : "",
				maritalStatus: patient.maritalStatus?.text,
			};
			return [
				"birthDate",
				"maritalStatus",
				"given",
				"gender",
				"telecom",
				"address",
			].flatMap((a) => {
				const attribute = this.searchAttribute(attributes, "type", a);
				const value = obj[a];
				if (attribute && value) {
					return [{ attribute, value }];
				}
				return [];
			});
		},
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {},
};
