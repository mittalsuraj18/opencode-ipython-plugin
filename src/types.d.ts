// Type declaration for importing Python files as text
declare module "*.py" {
	const content: string;
	export default content;
}
