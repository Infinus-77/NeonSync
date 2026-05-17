const s = "https://drive.google.com/uc?export=view&id=1_fcIcrirCazMKkywqqrX4AgN57huNiUz";
console.log(s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?export=view&id=)([a-zA-Z0-9_-]+)/));
