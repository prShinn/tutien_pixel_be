package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "status")
public class effectSkillEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Column(unique = true, nullable = false)
    private String code;
    private String name;
    private String description;
    private int thoiGian; //bao lau
    private int satThuong;
    private int lamCham;
    private String classCss;
    private int gayChoang;
    private String icon;
    private int isBuff;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public int getThoiGian() {
        return thoiGian;
    }

    public void setThoiGian(int thoiGian) {
        this.thoiGian = thoiGian;
    }

    public int getSatThuong() {
        return satThuong;
    }

    public void setSatThuong(int satThuong) {
        this.satThuong = satThuong;
    }

    public int getLamCham() {
        return lamCham;
    }

    public void setLamCham(int lamCham) {
        this.lamCham = lamCham;
    }

    public String getClassCss() {
        return classCss;
    }

    public void setClassCss(String classCss) {
        this.classCss = classCss;
    }

    public int getGayChoang() {
        return gayChoang;
    }

    public void setGayChoang(int gayChoang) {
        this.gayChoang = gayChoang;
    }
}
