"use strict";

const { capitalize } = require("lodash");
const { isArray } = require("lodash");
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "utils",
	/**
	 * Settings
	 */
	settings: {
	},
	/**
	 * Dependencies
	 */
	dependencies: ["es", "dhis2"],

	/**
	 * Actions
	 */
	actions: {
		Patient: {
			async handler(ctx) {
				const { Patient: { birthDate, name, gender, telecom, address, identifier, maritalStatus, managingOrganization } } = ctx.params;
				const entities = await ctx.call("es.search", { index: "entities", body: { query: { match: { "type.keyword": "Person" } }, size: 1000 } });
				const refOrganisation = this.getReference(managingOrganization);
				if (refOrganisation) {
					const organisationSearch = await ctx.call("es.searchBySystemAndCode", { ...refOrganisation, index: "organisations" });
					const orgUnit = this.getDHIS2Code(organisationSearch);
					if (orgUnit) {
						if (entities.length > 0) {
							const [entity] = entities;
							const trackedEntityType = this.getDHIS2Code(entity._source.mappings);
							const esAttributes = await ctx.call("es.search", { index: "attributes", body: { query: { match_all: {} }, size: 1000 } });
							const identifiers = esAttributes.filter((a) => a._source.identifier);
							if (identifiers.length > 0 && trackedEntityType !== undefined) {
								const extensions = esAttributes.filter((a) => a._source.type === "extension");
								let trackedEntityInstance = { trackedEntityType, orgUnit };
								let attributes = [];
								let patientIdentifiers = [];
								identifier.forEach((id) => {
									const [{ code, system }] = id.type.coding;
									const attribute = this.searchOne(identifiers, "mappings", "code", "system", code, system);
									if (attribute) {
										attributes = [...attributes, { attribute, value: id.value }];
										patientIdentifiers = [...patientIdentifiers, id.value]
									}
								});

								if (extensions && extensions.length > 0) {
									console.log("testing");
								}

								if (patientIdentifiers.length > 0) {
									if (birthDate) {
										const attribute = this.searchAttribute(esAttributes, "type", "birthDate");
										if (attribute) {
											attributes = [...attributes, { attribute, value: birthDate }];
										}
									}

									if (name && name.length > 0) {
										const [{ family, given }] = name;
										const attribute = this.searchAttribute(esAttributes, "type", "family");

										if (attribute) {
											attributes = [...attributes, { attribute, value: family + " " + given.join(" ") }];
										}
									}

									if (gender) {
										const attribute = this.searchAttribute(esAttributes, "type", "gender");
										if (attribute) {
											attributes = [...attributes, { attribute, value: capitalize(gender) }];
										}
									}

									if (telecom && telecom.length > 0) {
										const [{ value }] = telecom;
										const attribute = this.searchAttribute(esAttributes, "type", "telecom");
										if (attribute) {
											attributes = [...attributes, { attribute, value }];
										}
									}

									if (address && address.length > 0) {
										const [{ text }] = address;
										const attribute = this.searchAttribute(esAttributes, "type", "address");
										if (attribute) {
											attributes = [...attributes, { attribute, value: text }];
										}
									}
									if (maritalStatus && maritalStatus.length > 0) {
										const [{ text }] = address;
										const attribute = this.searchAttribute(esAttributes, "type", "maritalStatus");
										if (attribute) {
											attributes = [...attributes, { attribute, value: text }];
										}
									}
									trackedEntityInstance = { ...trackedEntityInstance, attributes };

									const patientSearch = await ctx.call("es.searchByValues", { term: "attributes", values: patientIdentifiers, index: "patients" });
									let response;
									let toBeIndexed = { attributes: patientIdentifiers, enrollments: [], encounters: [] };

									if (patientSearch) {
										toBeIndexed = { ...toBeIndexed, attributes: patientIdentifiers };
										trackedEntityInstance = { ...trackedEntityInstance, trackedEntityInstance: patientSearch.trackedEntityInstance };
									} else {
										const { codes: [code] } = await ctx.call("dhis2.get", { url: "system/id.json" });
										trackedEntityInstance = { ...trackedEntityInstance, trackedEntityInstance: code };
										toBeIndexed = { ...toBeIndexed, trackedEntityInstance: code }
									}
									try {
										response = await ctx.call("dhis2.post", { url: "trackedEntityInstances", ...trackedEntityInstance });
										await ctx.call("es.bulk", { index: "patients", dataset: [toBeIndexed], id: "trackedEntityInstance" });
									} catch (error) {
										response = error;
									}
									return response;
								}
							}
						}
					}
				} else {
					return "Managing organisation missing or identifier of managing organisation missing";
				}
			}
		},
		EpisodeOfCare: {
			async handler(ctx) {
				try {
					const {
						EpisodeOfCare: {
							id,
							type: [{ coding: [{ system, code }] }],
							period: { start },
							patient: { identifier: { value } },
							managingOrganization: { identifier: { system: ouSystem, value: ou } }
						}
					} = ctx.params;
					const programSearch = await ctx.call("es.searchBySystemAndCode", { system, value: code, index: "programs" });
					if (programSearch) {
						const program = this.getDHIS2Code(programSearch);
						const patientSearch = await ctx.call("es.searchByValues", { term: "attributes", values: [value], index: "patients" });
						if (patientSearch) {
							const { enrollments, trackedEntityInstance } = patientSearch;
							const organisationSearch = await ctx.call("es.searchBySystemAndCode", { system: ouSystem, value: ou, index: "organisations" });
							const orgUnit = this.getDHIS2Code(organisationSearch);
							if (orgUnit) {
								const previousEnrollment = enrollments.find((e) => {
									return e.enrollmentDate = start && e.program === program && e.orgUnit === orgUnit && e.id === id;
								});
								if (!previousEnrollment) {
									const { codes: [enrollment] } = await ctx.call("dhis2.get", { url: "system/id.json" });
									const enroll = {
										enrollment,
										enrollmentDate: start,
										incidentDate: start,
										orgUnit,
										trackedEntityInstance,
										program
									};
									const response = await ctx.call("dhis2.post", { url: "enrollments", ...enroll });
									await ctx.call("es.bulk", { index: "patients", dataset: [{ ...patientSearch, enrollments: [...enrollments, { ...enroll, id }] }], id: "trackedEntityInstance" });
									return response;
								} else {
									return { message: "Duplicate enrollment" };
								}
							} else {
								return { message: "No organisation " };
							}
						}
					}
					return programSearch;
				} catch (error) {
					return error;
				}
			}
		},
		Encounter: {
			async handler(ctx) {
				try {
					const {
						Encounter: {
							id,
							type: [{ coding: [{ system, code }] }],
							period: { start },
							subject: { identifier: { value } },
							episodeOfCare: [{ reference }],
							serviceProvider: { identifier: { system: ouSystem, value: ou } }
						}
					} = ctx.params;
					const encounterSearch = await ctx.call("es.searchBySystemAndCode", { system, value: code, index: "stages" });
					if (encounterSearch) {
						const programStage = this.getDHIS2Code(encounterSearch);
						if (programStage) {
							const patientSearch = await ctx.call("es.searchByValues", { term: "attributes", values: [value], index: "patients" });
							if (patientSearch) {
								const { enrollments, trackedEntityInstance, encounters } = patientSearch;
								const organisationSearch = await ctx.call("es.searchBySystemAndCode", { system: ouSystem, value: ou, index: "organisations" });
								const orgUnit = this.getDHIS2Code(organisationSearch);
								if (orgUnit) {
									const previousEnrollment = enrollments.find((e) => {
										return e.id === String(reference).replace("EpisodeOfCare/", "");
									});
									if (previousEnrollment) {
										const { program, enrollment } = previousEnrollment;
										const previousEncounter = encounters.find((e) => {
											return e.eventDate = start && e.program === program && e.orgUnit === orgUnit && e.id === id;
										});
										if (!previousEncounter) {
											const { codes: [event] } = await ctx.call("dhis2.get", { url: "system/id.json" });
											const encounter = {
												event,
												trackedEntityInstance,
												orgUnit,
												eventDate: start,
												program,
												programStage,
												enrollment
											}
											const response = await ctx.call("dhis2.post", { url: "events", ...encounter, dataValues: [] });
											await ctx.call("es.bulk", { index: "patients", dataset: [{ ...patientSearch, encounters: [...encounters, { ...encounter, id }] }], id: "trackedEntityInstance" });
											return response;
										}
										return { message: "Duplicate encounter" };
									}
									return { message: `No enrollment with ${reference} was found` };
								}
								return { message: `Organisation/Service provider with identifier ${ou} was found` };
							}
						}
						return { message: `No encounter mapping to DHIS2 with ${code} was found` };
					}
					return { message: `No encounter of type with  ${code} was found` };
				} catch (error) {
					return error;
				}
			}
		},
		Observation: {
			async handler(ctx) {
				try {
					const {
						Observation: {
							subject: { identifier: { value } },
							encounter: { reference },
							code: { coding: [{ system, code }] },
							valueQuantity,
							valueCodeableConcept,
							valueString,
							valueBoolean,
							valueInteger,
							valueTime,
							valueDateTime
						}
					} = ctx.params;

					let realValue = valueString || valueBoolean || valueInteger || valueTime || valueDateTime;
					if (valueQuantity) {
						realValue = valueQuantity.value;
					}
					if (valueCodeableConcept) {
						const { coding: [{ code: val }] } = valueCodeableConcept;
						realValue = val;
					}
					if (realValue) {
						const concept = await ctx.call("es.searchBySystemAndCode", { system, value: code, index: "concepts" });
						const dataElement = this.getDHIS2Code(concept);
						if (dataElement) {
							const patientSearch = await ctx.call("es.searchByValues", { term: "attributes", values: [value], index: "patients" });
							if (patientSearch) {
								const { encounters } = patientSearch;
								const previousEncounter = encounters.find((e) => {
									return e.id === String(reference).replace("Encounter/", "");
								});
								if (previousEncounter) {
									const { id, event, ...others } = previousEncounter;
									return await ctx.call("dhis2.put", { url: `events/${event}/${dataElement}`, ...others, event, dataValues: [{ dataElement, value: realValue }] });
								}
							}
						}
					}
				} catch (error) {
					return error
				}
			}
		}
	},

	/**
	 * Events
	 */
	events: {

	},

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
		searchOne(identifies, field, attribute1, attribute2, value1, value2) {
			const response = identifies.find(({ _source }) => {
				return _source[field].find((mapping) => mapping[attribute1] === value1 && mapping[attribute2] === value2) !== undefined;
			});
			if (response) {
				const { _source: { mappings } } = response;
				return this.getDHIS2Code(mappings);
			}
			return undefined;
		},
		searchOneByOneAttribute(attributes, field, attribute, value) {
			const response = attributes.find(({ _source }) => {
				return _source[field].find((mapping) => mapping[attribute] === value) !== undefined;
			});
			if (response) {
				const { _source: { mappings } } = response;
				return this.getDHIS2Code(mappings);
			}
			return undefined;
		},

		searchAttribute(attributes, type, value) {
			const attribute = attributes.find(({ _source }) => _source[type] === value);
			if (attribute) {
				return this.getDHIS2Code(attribute._source.mappings);
			}
		},
		getReference(ref) {
			if (ref && ref.identifier && ref.identifier.system && ref.identifier.value) {
				return ref.identifier;
			}
		},
		getObsValue(value) {

		},
		async getOrganisation(managingOrganization) {
			const organisation = this.getReference(managingOrganization);
			if (organisation) {
				const { system, value } = organisation;

			}
		}
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {

	},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {

	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {

	}
};
