import { toast } from "vue-sonner";
import { h, defineComponent } from "vue";
import { plainMessage } from "@/lib/offlineMessage";

function htmlComponent(html: string) {
	return defineComponent({ render: () => h("div", { innerHTML: html }) });
}

function toastContent(message: string): string | ReturnType<typeof defineComponent> {
	return /<[a-z][\s\S]*>/i.test(message) ? htmlComponent(message) : message;
}

export function useToast() {
	const success = (message: string, options?: { duration?: number; description?: string }) => {
		return (toast.success as Function)(toastContent(message), {
			duration: options?.duration || 3000,
			description: options?.description,
		});
	};

	const error = (message: string, options?: { duration?: number; description?: string }) => {
		return (toast.error as Function)(toastContent(message), {
			duration: options?.duration || 5000,
			description: options?.description,
		});
	};

	const info = (message: string, options?: { duration?: number; description?: string }) => {
		return (toast.info as Function)(toastContent(message), {
			duration: options?.duration || 3000,
			description: options?.description,
		});
	};

	const warning = (message: string, options?: { duration?: number; description?: string }) => {
		return (toast.warning as Function)(toastContent(message), {
			duration: options?.duration || 4000,
			description: options?.description,
		});
	};

	const message = (content: string, options?: { duration?: number; description?: string }) => {
		return (toast as Function)(toastContent(content), {
			duration: options?.duration || 3000,
			description: options?.description,
		});
	};

	const loading = (message: string) => {
		return toast.loading(message);
	};

	const dismiss = (toastId?: string | number) => {
		return toast.dismiss(toastId);
	};

	const dismissAll = () => {
		return toast.dismiss();
	};

	return {
		success,
		error,
		info,
		warning,
		message,
		loading,
		dismiss,
		dismissAll,
		toast,
	};
}

export function showSuccess(message: string): void {
	const { success } = useToast();
	success(message);
}

export function showError(message: string): void {
	const { error } = useToast();
	error(plainMessage(String(message)));
}

export function showInfo(message: string): void {
	const { info } = useToast();
	info(message);
}
