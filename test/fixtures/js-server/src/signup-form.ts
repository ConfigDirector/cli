import { useForm } from "react-hook-form";

const form = useForm();
export const emailAddress = () => form.watch("email-address");
