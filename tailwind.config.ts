import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        indigo: {50:'#eef4f1',100:'#dce9e1',200:'#b8d1c2',300:'#8eb39e',400:'#65977d',500:'#46785f',600:'#315e49',700:'#284e3d',800:'#234032',900:'#1d352a',950:'#111f19'},
        purple: {50:'#f5f1eb',100:'#ece3d7',200:'#dbcaaf',300:'#c5ac8b',400:'#b18d64',500:'#95734f',600:'#785b40',700:'#624a36',800:'#513e30',900:'#44352a',950:'#271d17'},
        gray: {50:'#f8f7f4',100:'#efede7',200:'#e0ddd4',300:'#cbc7bb',400:'#97978c',500:'#6a7066',600:'#505a50',700:'#3d483e',800:'#2b392f',900:'#1c2b22',950:'#111b15'},
      },
      boxShadow: { sm:'0 2px 10px rgb(29 53 42 / 0.035)', xl:'0 18px 50px rgb(29 53 42 / 0.07)', '2xl':'0 24px 70px rgb(29 53 42 / 0.10)' },
    },
  },
  plugins: [],
};
export default config;
