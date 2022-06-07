"use strict";
const { capitalize } = require("lodash");
const { isArray } = require("lodash");
const { generateUid } = require("./uid");
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "resources",
	/**
	 * Settings
	 */
	settings: {},
	/**
	 * Dependencies
	 */
	dependencies: ["es", "dhis2", "search"],

	/**
	 * Actions
	 */
	actions: {
		Patient: {
			async handler(ctx) {
				const { Patient: patient } = ctx.params;
				try {
					const trackedEntityType = await ctx.call("search.entity");
					if (trackedEntityType) {
						const orgUnit = await ctx.call(
							"search.facility",
							patient.managingOrganization
						);
						if (orgUnit) {
							const { identifiers, biodata } = await ctx.call(
								"search.patient",
								patient
							);
							const identifierValues = identifiers.map((i) => i.value);
							if ([...identifierValues, ...biodata].length > 0 || patient.id) {
								let trackedEntityInstance = {
									trackedEntityType,
									orgUnit,
									attributes: [...identifiers, ...biodata],
								};

								let toBeIndexed = {
									attributes: identifierValues,
									enrollments: [],
									encounters: [],
								};

								if (patient.id) {
									toBeIndexed = { ...toBeIndexed, id: patient.id };
								}
								const previousPatient = await ctx.call(
									"search.previousPatient",
									{
										id: patient.id,
										identifiers: identifierValues,
									}
								);

								if (previousPatient) {
									toBeIndexed = {
										...previousPatient,
										attributes: identifierValues,
									};
									if (patient.id) {
										toBeIndexed = {
											...previousPatient,
											attributes: identifierValues,
											id: patient.id,
										};
									}
									trackedEntityInstance = {
										...trackedEntityInstance,
										trackedEntityInstance:
											previousPatient.trackedEntityInstance,
									};
								} else {
									const code = generateUid();
									trackedEntityInstance = {
										...trackedEntityInstance,
										trackedEntityInstance: code,
									};
									toBeIndexed = {
										...toBeIndexed,
										trackedEntityInstance: code,
									};
								}
								const response = await ctx.call("dhis2.post", {
									url: "trackedEntityInstances",
									...trackedEntityInstance,
								});
								await ctx.call("es.bulk", {
									index: "patients",
									dataset: [toBeIndexed],
									id: "trackedEntityInstance",
								});
								return response;
							}
						}
					}
				} catch (error) {
					return error.message;
				}
			},
		},
		EpisodeOfCare: {
			async handler(ctx) {
				const {
					EpisodeOfCare: {
						id,
						type: [
							{
								coding: [{ system, code, display }],
							},
						],
						period: { start },
						patient: { identifier, reference },
						managingOrganization,
					},
				} = ctx.params;

				let patient = {
					identifier: [],
				};
				if (reference) {
					patient = {
						...patient,
						id: String(reference).replace("Patient/", ""),
					};
				}

				if (identifier) {
					patient = {
						...patient,
						identifiers: identifier.map((id) => id.value),
					};
				}

				const program = await ctx.call("search.program", {
					system: system || display,
					code,
				});

				const orgUnit = await ctx.call("search.facility", managingOrganization);

				if (program !== null && orgUnit !== null) {
					const previousPatient = await ctx.call(
						"search.previousPatient",
						patient
					);

					if (previousPatient !== null) {
						const { enrollments, trackedEntityInstance } = previousPatient;
						const previousEnrollment = enrollments.find((e) => {
							return (e.enrollmentDate =
								start &&
								e.program === program &&
								e.orgUnit === orgUnit &&
								e.id === id);
						});

						if (!previousEnrollment) {
							const enrollment = generateUid();
							const enroll = {
								enrollment,
								enrollmentDate: start,
								incidentDate: start,
								orgUnit,
								trackedEntityInstance,
								program,
							};
							const response = await ctx.call("dhis2.post", {
								url: "enrollments",
								...enroll,
							});
							await ctx.call("es.bulk", {
								index: "patients",
								dataset: [
									{
										...previousPatient,
										enrollments: [...enrollments, { ...enroll, id }],
									},
								],
								id: "trackedEntityInstance",
							});
							return response;
						} else {
							return { message: "Already enrolled" };
						}
					}
				}
			},
		},
		Encounter: {
			async handler(ctx) {
				try {
					const {
						Encounter: {
							id,
							type: [
								{
									coding: [{ system, code }],
								},
							],
							period: { start },
							subject: { reference, identifier },
							serviceProvider,
							episodeOfCare,
						},
					} = ctx.params;

					const programStage = await ctx.call("search.stage", { system, code });
					const orgUnit = await ctx.call("search.facility", serviceProvider);

					if (programStage !== null && orgUnit !== null) {
						let patient = {
							identifier: [],
						};
						if (reference) {
							patient = {
								...patient,
								id: String(reference).replace("Patient/", ""),
							};
						}
						if (identifier) {
							patient = {
								...patient,
								identifiers: identifier.map((id) => id.value),
							};
						}
						const previousPatient = await ctx.call(
							"search.previousPatient",
							patient
						);

						if (previousPatient !== null) {
							const { enrollments, trackedEntityInstance, encounters } =
								previousPatient;

							const previousEnrollment = enrollments.find((e) => {
								return (
									e.id ===
									String(episodeOfCare.reference).replace("EpisodeOfCare/", "")
								);
							});
							if (previousEnrollment && programStage !== null) {
								const { program, enrollment } = previousEnrollment;
								const previousEncounter = encounters.find((e) => {
									return (e.eventDate =
										start &&
										e.program === program &&
										e.orgUnit === orgUnit &&
										e.id === id);
								});
								if (!previousEncounter) {
									const event = generateUid();
									const encounter = {
										event,
										trackedEntityInstance,
										orgUnit,
										eventDate: start,
										program,
										programStage,
										enrollment,
									};
									const response = await ctx.call("dhis2.post", {
										url: "events",
										...encounter,
										dataValues: [],
									});
									await ctx.call("es.bulk", {
										index: "patients",
										dataset: [
											{
												...previousPatient,
												encounters: [...encounters, { ...encounter, id }],
											},
										],
										id: "trackedEntityInstance",
									});
									return response;
								}
							}
						}
					}

					return "No record was inserted some information is missing";
				} catch (error) {
					return error.message;
				}
			},
		},
		Observation: {
			async handler(ctx) {
				try {
					const {
						Observation: {
							subject,
							encounter,
							code: {
								coding: [{ system, code }],
							},
							valueQuantity,
							valueCodeableConcept,
							valueString,
							valueBoolean,
							valueInteger,
							valueTime,
							valueDateTime,
						},
					} = ctx.params;

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
						const {
							coding: [{ code: val }],
						} = valueCodeableConcept;
						realValue = val;
					}
					if (realValue) {
						const dataElement = await await ctx.call("search.concept", {
							system,
							code,
						});
						let patient = {
							identifier: [],
						};
						if (subject.reference) {
							patient = {
								...patient,
								id: String(subject.reference).replace("Patient/", ""),
							};
						}
						if (subject.identifier) {
							patient = {
								...patient,
								identifiers: subject.identifier.map((id) => id.value),
							};
						}
						if (dataElement) {
							const previousPatient = await ctx.call(
								"search.previousPatient",
								patient
							);
							if (previousPatient) {
								const { encounters } = previousPatient;
								const previousEncounter = encounters.find((e) => {
									return e.id === String(encounter.reference).replace("Encounter/", "");
								});
								if (previousEncounter) {
									const { id, event, ...others } = previousEncounter;
									return await ctx.call("dhis2.put", {
										url: `events/${event}/${dataElement}`,
										...others,
										event,
										dataValues: [{ dataElement, value: realValue }],
									});
								}
							}
						}
					}
				} catch (error) {
					return error;
				}
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
		searchOne(identifies, field, attribute1, attribute2, value1, value2) {
			const response = identifies.find(({ _source }) => {
				return (
					_source[field].find(
						(mapping) =>
							mapping[attribute1] === value1 && mapping[attribute2] === value2
					) !== undefined
				);
			});
			if (response) {
				const {
					_source: { mappings },
				} = response;
				return this.getDHIS2Code(mappings);
			}
			return undefined;
		},
		searchOneByOneAttribute(attributes, field, attribute, value) {
			const response = attributes.find(({ _source }) => {
				return (
					_source[field].find((mapping) => mapping[attribute] === value) !==
					undefined
				);
			});
			if (response) {
				const {
					_source: { mappings },
				} = response;
				return this.getDHIS2Code(mappings);
			}
			return undefined;
		},

		searchAttribute(attributes, type, value) {
			const attribute = attributes.find(({ _source }) => {
				return _source[type] === value;
			});
			if (attribute) {
				return this.getDHIS2Code(attribute._source.mappings);
			}
		},
		getReference(ref) {
			if (ref && ref.identifier && ref.identifier.value) {
				return ref.identifier.value;
			} else if (ref.reference) {
				return String(ref.reference).replace("Organization/", "");
			}
		},
		getObsValue(value) {},
		async getOrganisation(managingOrganization) {
			const organisation = this.getReference(managingOrganization);
			if (organisation) {
				const { system, value } = organisation;
			}
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
